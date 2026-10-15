// Analiz türleri: tam analiz (Lighthouse'un 4 kategorisi + gerçek kullanıcı verisi) ve özel mod (tek bir analiz).
import { runAudit, ALL_CATEGORIES } from './psi.js';
import { fetchCruxApi } from './checks/crux.js';
import { runObservatory } from './checks/observatory.js';
import { runSslLabs } from './checks/ssllabs.js';
import { runW3c } from './checks/w3c.js';
import { runLinkCheck } from './checks/links.js';

// usesDevice: Mobil/Masaüstü seçimi yalnızca PageSpeed tabanlı analizleri etkiler.
export const ANALYSES = [
  { id: 'performance', label: 'Performance', group: 'Lighthouse', usesDevice: true },
  { id: 'accessibility', label: 'Accessibility', group: 'Lighthouse', usesDevice: true },
  { id: 'best-practices', label: 'Best Practices', group: 'Lighthouse', usesDevice: true },
  { id: 'seo', label: 'SEO', group: 'Lighthouse', usesDevice: true },
  { id: 'crux', label: 'Gerçek Kullanıcı (CrUX)', group: 'Gerçek kullanıcı verisi', usesDevice: true },
  { id: 'security', label: 'Güvenlik Başlıkları', group: 'Güvenlik', usesDevice: false },
  { id: 'ssl', label: 'SSL/TLS', group: 'Güvenlik', usesDevice: false },
  { id: 'html', label: 'HTML Doğrulama', group: 'Kod ve içerik', usesDevice: false },
  { id: 'links', label: 'Kırık Bağlantılar', group: 'Kod ve içerik', usesDevice: false },
];

export const ANALYSIS_IDS = new Set(ANALYSES.map((a) => a.id));
const LIGHTHOUSE = new Set(ALL_CATEGORIES);

const external = (run) => async (url, deps) => ({
  finalUrl: url,
  fetchedAt: new Date().toISOString(),
  stacks: [],
  warnings: [],
  categories: [await run(url, deps)],
});

const RUNNERS = {
  security: external(runObservatory),
  ssl: external(runSslLabs),
  html: external(runW3c),
  links: external(runLinkCheck),
};

// CrUX API anahtarda açıksa saniyeler içinde döner; değilse PageSpeed'in en hafif kategorisiyle aynı veri alınır.
async function runCrux(url, { strategy, apiKey, audit, cruxApi }) {
  try {
    const crux = await cruxApi(url, { apiKey });
    return { finalUrl: url, fetchedAt: new Date().toISOString(), stacks: [], warnings: [], categories: [crux] };
  } catch {
    const { crux, ...lh } = await audit(url, { strategy, apiKey, categories: ['seo'] });
    return { ...lh, warnings: [], categories: [crux] };
  }
}

export async function runAnalysis(url, { strategy = 'mobile', apiKey, mode = 'full', analysis, audit = runAudit, cruxApi = fetchCruxApi, deps = {} } = {}) {
  if (mode === 'full') {
    const { crux, ...lh } = await audit(url, { strategy, apiKey, categories: ALL_CATEGORIES });
    return { ...lh, categories: crux ? [...lh.categories, crux] : lh.categories };
  }
  if (!ANALYSIS_IDS.has(analysis)) throw Object.assign(new Error('Geçersiz analiz türü.'), { status: 400 });
  if (LIGHTHOUSE.has(analysis)) {
    const { crux, ...lh } = await audit(url, { strategy, apiKey, categories: [analysis] });
    return lh;
  }
  if (analysis === 'crux') return runCrux(url, { strategy, apiKey, audit, cruxApi });
  return RUNNERS[analysis](url, deps);
}
