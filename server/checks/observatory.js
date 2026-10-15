// Mozilla HTTP Observatory: HTTP güvenlik başlıklarını (CSP, HSTS, X-Frame-Options vb.) puanlar.
// İsteği Mozilla'nın sunucusu atar; bizim sunucumuz hedef siteye bağlanmaz.

const API = 'https://observatory-api.mdn.mozilla.net/api/v2';
const MDN = 'https://developer.mozilla.org';

export const stripHtml = (html) =>
  String(html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

// Test verisi (ör. CSP yönergeleri) okunur satırlara çevrilir.
function dataLines(data) {
  if (!data || typeof data !== 'object') return [];
  return Object.entries(data)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(' ') : typeof v === 'object' ? JSON.stringify(v) : String(v)}`)
    .map((line) => line.slice(0, 300))
    .slice(0, 8);
}

export function normalizeObservatory(analysis, host) {
  const scan = analysis?.scan;
  if (!scan || scan.error) throw Object.assign(new Error(`Mozilla Observatory taraması başarısız: ${scan?.error ?? 'yanıt yok'}`), { status: 502 });
  const tests = Object.values(analysis.tests ?? {});
  const issues = tests
    .filter((t) => t && t.pass === false)
    .map((t) => ({
      id: `observatory-${t.name}`,
      title: t.title ?? t.name,
      description: [stripHtml(t.score_description), t.recommendation ? `Öneri: ${stripHtml(t.recommendation)}` : ''].filter(Boolean).join(' '),
      docsUrl: t.link ? (t.link.startsWith('http') ? t.link : `${MDN}${t.link}`) : null,
      score: 0,
      scoreMode: 'binary',
      displayValue: `Puan etkisi: ${t.score_modifier ?? 0} · Sonuç: ${t.result}`,
      weight: Math.abs(t.score_modifier ?? 0) || 1,
      savings: [],
      items: dataLines(t.data),
    }))
    .sort((a, b) => b.weight - a.weight);
  return {
    id: 'security',
    label: 'Güvenlik Başlıkları',
    source: 'Mozilla HTTP Observatory',
    score: Math.max(0, Math.min(100, scan.score ?? 0)),
    issues,
    note: `Mozilla Observatory notu: ${scan.grade} (puan ${scan.score}; ${scan.tests_passed}/${scan.tests_quantity} test geçti). Ayrıntılı rapor: ${MDN}/en-US/observatory/analyze?host=${encodeURIComponent(host)}`,
  };
}

export async function runObservatory(url, { fetchFn = fetch } = {}) {
  const host = new URL(url).hostname;
  // POST yeni tarama başlatır (Mozilla yakın zamanda taranmışsa önbellekten döner); ardından test ayrıntıları alınır.
  const scanRes = await fetchFn(`${API}/scan?host=${encodeURIComponent(host)}`, { method: 'POST', signal: AbortSignal.timeout(90_000) });
  if (!scanRes.ok) throw Object.assign(new Error(`Mozilla Observatory yanıt vermedi (${scanRes.status}).`), { status: 502 });
  const res = await fetchFn(`${API}/analyze?host=${encodeURIComponent(host)}`, { signal: AbortSignal.timeout(30_000) });
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) throw Object.assign(new Error(`Mozilla Observatory ayrıntıları alınamadı (${res.status}).`), { status: 502 });
  return normalizeObservatory(body, host);
}
