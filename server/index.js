import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { parseTargetUrl } from './url-guard.js';
import { runAudit } from './psi.js';
import { runAnalysis, ANALYSIS_IDS } from './analyses.js';
import { attachPrompts } from './prompts.js';
import { getConfig } from './config.js';
import { analyzeWithAi } from './ai.js';
import { saveReport, getEntry } from './report-store.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const RATE_LIMIT = 10; // IP başına dakikadaki denetim sayısı
const AI_RATE_LIMIT = 6; // IP başına dakikadaki AI analizi sayısı

const WINDOW_MS = 60_000;

export function createLimiter(limit, now = Date.now) {
  const hits = new Map();
  let lastSweep = now();
  const limited = (ip) => {
    const t = now();
    // Süresi dolmuş IP kayıtlarını dakikada bir temizle; aksi halde Map sınırsız büyür.
    if (t - lastSweep >= WINDOW_MS) {
      for (const [key, list] of hits) {
        if (!list.length || t - list[list.length - 1] >= WINDOW_MS) hits.delete(key);
      }
      lastSweep = t;
    }
    const recent = (hits.get(ip) ?? []).filter((x) => t - x < WINDOW_MS);
    recent.push(t);
    hits.set(ip, recent);
    return recent.length > limit;
  };
  limited.size = () => hits.size;
  return limited;
}

// X-Forwarded-For yalnızca önümüzde gerçekten proxy varsa güvenilir; yoksa istemci IP'sini uydurur
// ve hız sınırını aşar. Cloud Run K_SERVICE tanımlar; başka ortamlar TRUST_PROXY ile ayarlar.
export function trustProxySetting(env = process.env) {
  const v = env.TRUST_PROXY;
  if (v === undefined || v === '') return env.K_SERVICE ? 1 : false;
  if (/^\d+$/.test(v)) return Number(v);
  if (v === 'false') return false;
  return v;
}

export function createApp({ audit = runAudit, analyze = runAnalysis, ai = analyzeWithAi, config = getConfig } = {}) {
  const app = express();
  const auditLimited = createLimiter(RATE_LIMIT);
  const aiLimited = createLimiter(AI_RATE_LIMIT);
  app.disable('x-powered-by');
  app.set('trust proxy', trustProxySetting());

  app.get('/api/audit', async (req, res) => {
    if (auditLimited(req.ip)) {
      return res.status(429).json({ error: 'Çok fazla istek. Bir dakika sonra tekrar dene.' });
    }
    let target;
    try {
      target = parseTargetUrl(req.query.url);
    } catch (e) {
      return res.status(400).json({ error: e.message });
    }
    const strategy = req.query.strategy === 'desktop' ? 'desktop' : 'mobile';
    // Tam analiz: Lighthouse'un 4 kategorisi + gerçek kullanıcı verisi. Özel mod: yalnızca seçilen tek analiz.
    const mode = req.query.mode === 'custom' ? 'custom' : 'full';
    const analysis = mode === 'custom' ? String(req.query.analysis ?? '') : null;
    if (mode === 'custom' && !ANALYSIS_IDS.has(analysis)) {
      return res.status(400).json({ error: 'Özel mod için geçerli bir analiz türü seç.' });
    }
    try {
      const { pagespeedKey } = await config();
      const result = await analyze(target.href, { strategy, apiKey: pagespeedKey, mode, analysis, audit });
      const report = { strategy, mode, analysis, ...result };
      const reportId = saveReport(report);
      res.json({ reportId, ...attachPrompts(report) });
    } catch (e) {
      console.error('denetim başarısız:', e.message);
      // Yalnızca bilinçli olarak status atanmış (kullanıcıya yönelik) hata mesajları gösterilir.
      res.status(e.status ?? 502).json({ error: e.status ? e.message : 'Analiz şu an yapılamadı. Biraz sonra tekrar dene.' });
    }
  });

  app.get('/api/ai', async (req, res) => {
    if (aiLimited(req.ip)) {
      return res.status(429).json({ error: 'Çok fazla AI isteği. Bir dakika sonra tekrar dene.' });
    }
    const entry = getEntry(req.query.reportId);
    if (!entry) {
      return res.status(404).json({ error: 'Rapor bulunamadı veya süresi doldu. Analizi yeniden çalıştır.' });
    }
    if (entry.ai) return res.json(entry.ai);
    try {
      // Aynı rapor için eşzamanlı istekler tek Gemini çağrısını paylaşır.
      entry.aiPending ??= (async () => {
        const { geminiKey, model, temperature } = await config();
        return ai(entry.report, { apiKey: geminiKey, model, temperature });
      })();
      entry.ai = await entry.aiPending;
      res.json(entry.ai);
    } catch (e) {
      entry.aiPending = null; // başarısız denemeden sonra yeniden denenebilsin
      console.error('AI analizi başarısız:', e.message);
      res.status(502).json({ error: 'AI analizi şu an yapılamadı. Temel rapor geçerli, tekrar deneyebilirsin.' });
    }
  });

  app.use(express.static(PUBLIC_DIR));
  return app;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => console.log(`http://localhost:${port}`));
}
