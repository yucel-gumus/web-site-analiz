import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { parseTargetUrl } from './url-guard.js';
import { runAudit } from './psi.js';
import { runAnalysis, ANALYSIS_IDS } from './analyses.js';
import { attachPrompts } from './prompts.js';
import { getConfig, getCachedCorsOrigins } from './config.js';
import { analyzeWithAi } from './ai.js';
import { saveReport, getEntry } from './report-store.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const RATE_LIMIT = 10; // IP başına dakikadaki denetim sayısı
const AI_RATE_LIMIT = 6; // IP başına dakikadaki AI analizi sayısı

const WINDOW_MS = 60_000;
const TELEMETRY_URL = 'https://python-backend-270384591051.europe-west3.run.app/api/telemetry/event';

function notifyServerTelemetry(req, action, detail) {
  if (process.env.NODE_ENV === 'test') return;
  const host = String(req.get('host') || '');
  if (!host || /^(localhost|127\.0\.0\.1)(:|$)/i.test(host)) return;
  const clientIp = req.ip || req.socket?.remoteAddress || 'unknown';
  void fetch(TELEMETRY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'https://site-analiz.web.app',
      'User-Agent': 'YucelTelemetryServer/site-analiz',
    },
    body: JSON.stringify({
      project: 'site-analiz',
      event: 'action',
      action,
      ...(detail ? { detail: String(detail).slice(0, 80) } : {}),
      path: req.path,
      source: 'server',
      client_ip: clientIp,
    }),
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

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

// Firebase Hosting, Cloud Run'a yönlendirdiği istekleri 60 sn'de keser; uzun analizler için sayfa
// site-analiz.web.app'ten açılır ama API doğrudan Cloud Run'a çağrılır. Yalnızca bu kökenlere izin verilir.
const DEFAULT_CORS_ORIGINS = ['https://site-analiz.web.app', 'https://site-analiz.firebaseapp.com'];

export function corsOrigins(env = process.env) {
  return env.CORS_ORIGINS ? env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean) : DEFAULT_CORS_ORIGINS;
}

export function createApp({ audit = runAudit, analyze = runAnalysis, ai = analyzeWithAi, config = getConfig } = {}) {
  const app = express();
  const auditLimited = createLimiter(RATE_LIMIT);
  const aiLimited = createLimiter(AI_RATE_LIMIT);
  app.disable('x-powered-by');
  const staticAllowed = new Set(corsOrigins());
  app.use('/api', async (req, res, next) => {
    const origin = req.get('origin');
    if (origin) {
      let allow = staticAllowed.has(origin);
      if (!allow) {
        const cached = getCachedCorsOrigins();
        if (cached) {
          allow = cached.includes(origin);
        } else {
          const cfg = await config().catch(() => null);
          allow = Array.isArray(cfg?.corsOrigins) && cfg.corsOrigins.includes(origin);
        }
      }
      if (allow) {
        res.set('Access-Control-Allow-Origin', origin);
        res.vary('Origin');
      }
    }
    next();
  });
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
    notifyServerTelemetry(
      req,
      'audit',
      `${target.hostname} (${mode === 'custom' ? analysis : 'full'})`,
    );
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
    let aiHost = '';
    try {
      if (entry.report?.url) aiHost = new URL(entry.report.url).hostname;
    } catch {
      aiHost = '';
    }
    notifyServerTelemetry(req, 'ai_review', aiHost);
    if (entry.ai) return res.json(entry.ai);
    try {
      // Aynı rapor için eşzamanlı istekler tek Gemini çağrısını paylaşır.
      entry.aiPending ??= (async () => {
        const { geminiKey, geminiKeys, model, thinkingLevel, fallbackModels, temperature } = await config();
        return ai(entry.report, { apiKey: geminiKey, apiKeys: geminiKeys, model, thinkingLevel, fallbackModels, temperature });
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
