// Chrome UX Report (CrUX): son 28 günde gerçek Chrome kullanıcılarından toplanan Core Web Vitals verisi.
// Kaynak iki yoldan gelebilir: PageSpeed yanıtındaki loadingExperience alanı ya da (anahtarda açıksa) CrUX API.

const CRUX_API = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';

// Eşikler web.dev'deki resmi "iyi / iyileştirilmeli / kötü" sınırlarıdır.
const METRICS = [
  { key: 'LCP', psi: 'LARGEST_CONTENTFUL_PAINT_MS', api: 'largest_contentful_paint', name: 'Largest Contentful Paint', good: 2500, poor: 4000, core: true, docs: 'https://web.dev/articles/lcp' },
  { key: 'INP', psi: 'INTERACTION_TO_NEXT_PAINT', api: 'interaction_to_next_paint', name: 'Interaction to Next Paint', good: 200, poor: 500, core: true, docs: 'https://web.dev/articles/inp' },
  { key: 'CLS', psi: 'CUMULATIVE_LAYOUT_SHIFT_SCORE', api: 'cumulative_layout_shift', name: 'Cumulative Layout Shift', good: 0.1, poor: 0.25, core: true, unitless: true, docs: 'https://web.dev/articles/cls' },
  { key: 'FCP', psi: 'FIRST_CONTENTFUL_PAINT_MS', api: 'first_contentful_paint', name: 'First Contentful Paint', good: 1800, poor: 3000, docs: 'https://web.dev/articles/fcp' },
  { key: 'TTFB', psi: 'EXPERIMENTAL_TIME_TO_FIRST_BYTE', api: 'experimental_time_to_first_byte', name: 'Time to First Byte', good: 800, poor: 1800, docs: 'https://web.dev/articles/ttfb' },
];

const RATING_LABEL = { good: 'İyi', ni: 'İyileştirilmeli', poor: 'Kötü' };
const rate = (m, v) => (v <= m.good ? 'good' : v <= m.poor ? 'ni' : 'poor');
const pct = (x) => `%${Math.round((x ?? 0) * 100)}`;

export function formatMetric(m, v) {
  if (m.unitless) return v.toFixed(2);
  return v >= 1000 ? `${(v / 1000).toFixed(1).replace('.', ',')} sn` : `${Math.round(v)} ms`;
}

// PSI biçimi: { metrics: { LARGEST_CONTENTFUL_PAINT_MS: { percentile, distributions: [{proportion}] } } }
function fromPsi(exp) {
  if (!exp?.metrics) return [];
  return METRICS.flatMap((m) => {
    const raw = exp.metrics[m.psi];
    if (typeof raw?.percentile !== 'number') return [];
    const p75 = m.key === 'CLS' ? raw.percentile / 100 : raw.percentile; // PSI CLS'yi 100 katı verir
    return [{ m, p75, dist: (raw.distributions ?? []).map((d) => d.proportion) }];
  });
}

// CrUX API biçimi: { record: { metrics: { largest_contentful_paint: { percentiles: { p75 }, histogram: [{density}] } } } }
function fromApi(body) {
  const metrics = body?.record?.metrics;
  if (!metrics) return [];
  return METRICS.flatMap((m) => {
    const raw = metrics[m.api];
    const p75 = Number(raw?.percentiles?.p75);
    if (!Number.isFinite(p75)) return [];
    return [{ m, p75, dist: (raw.histogram ?? []).map((h) => h.density) }];
  });
}

function buildCategory(page, origin, sourceLabel) {
  const rows = page.length ? page : origin;
  const scope = page.length ? 'bu sayfa' : 'site geneli (sayfa için yeterli veri yok)';
  const base = { id: 'crux', label: 'Gerçek Kullanıcı (CrUX)', source: sourceLabel };
  if (!rows.length) {
    return {
      ...base,
      score: null,
      issues: [],
      note: 'Bu site için Chrome gerçek kullanıcı verisi yok. Google, yalnızca son 28 günde yeterli sayıda Chrome kullanıcısının ziyaret ettiği sayfa ve siteler için bu veriyi yayınlar. Trafik arttıkça veri oluşur; o zamana kadar Lighthouse (laboratuvar) sonuçlarını esas al.',
    };
  }

  const rated = rows.map((r) => ({ ...r, rating: rate(r.m, r.p75) }));
  const core = rated.filter((r) => r.m.core);
  const coreMissing = core.length < METRICS.filter((m) => m.core).length;
  const coreVerdict = coreMissing
    ? 'Core Web Vitals değerlendirmesi için yeterli veri yok.'
    : core.every((r) => r.rating === 'good')
      ? 'Core Web Vitals değerlendirmesi: GEÇTİ (LCP, INP ve CLS iyi).'
      : 'Core Web Vitals değerlendirmesi: GEÇEMEDİ.';
  const originByKey = new Map(origin.map((r) => [r.m.key, r]));

  const issues = rated
    .filter((r) => r.rating !== 'good')
    .map(({ m, p75, dist, rating }) => {
      const items = [];
      if (dist.length >= 3) items.push(`Ziyaret dağılımı: İyi ${pct(dist[0])} · İyileştirilmeli ${pct(dist[1])} · Kötü ${pct(dist[2])}`);
      const o = page.length ? originByKey.get(m.key) : null;
      if (o) items.push(`Site geneli p75: ${formatMetric(m, o.p75)} (${RATING_LABEL[rate(m, o.p75)]})`);
      return {
        id: `crux-${m.key.toLowerCase()}`,
        title: `${m.key} (${m.name}) — gerçek kullanıcılar`,
        description: `Ziyaretlerin %75'i bu değerde veya daha iyisinde. Eşikler: iyi ≤ ${formatMetric(m, m.good)}, kötü > ${formatMetric(m, m.poor)}.${m.core ? ' Core Web Vitals metriğidir; Google sıralama sinyali olarak kullanır.' : ''}`,
        docsUrl: m.docs,
        score: rating === 'ni' ? 0.5 : 0,
        scoreMode: 'numeric',
        displayValue: `p75: ${formatMetric(m, p75)} · ${RATING_LABEL[rating]}`,
        weight: (rating === 'poor' ? 10 : 5) * (m.core ? 2 : 1),
        savings: [],
        items,
      };
    })
    .sort((a, b) => b.weight - a.weight);

  const passing = rated.filter((r) => r.rating === 'good').map((r) => `${r.m.key} ${formatMetric(r.m, r.p75)}`);
  return {
    ...base,
    score: Math.round((100 * rated.filter((r) => r.rating === 'good').length) / rated.length),
    issues,
    note: [
      `Kaynak: son 28 günün gerçek Chrome kullanıcı verisi (${scope}). ${coreVerdict}`,
      passing.length ? `İyi durumdaki metrikler: ${passing.join(', ')}.` : '',
      'Skor, ölçülen metriklerden kaçının "iyi" eşiğinde olduğunu gösterir.',
    ].filter(Boolean).join(' '),
  };
}

export const normalizeCruxFromPsi = (loadingExperience, originLoadingExperience) =>
  buildCategory(fromPsi(loadingExperience), fromPsi(originLoadingExperience), 'PageSpeed Insights (CrUX)');

async function queryApi(body, apiKey, fetchFn) {
  const res = await fetchFn(`${CRUX_API}?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 404) return null; // bu URL/origin için veri yok
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json?.error?.message ?? `CrUX API hatası (${res.status})`);
  return json;
}

// CrUX API anahtarda etkin değilse hata fırlatır; çağıran PageSpeed yoluna düşer.
export async function fetchCruxApi(url, { apiKey, fetchFn = fetch } = {}) {
  if (!apiKey) throw new Error('CrUX API için anahtar yok.');
  const origin = new URL(url).origin;
  const [page, site] = await Promise.all([queryApi({ url }, apiKey, fetchFn), queryApi({ origin }, apiKey, fetchFn)]);
  return buildCategory(fromApi(page), fromApi(site), 'Chrome UX Report API');
}
