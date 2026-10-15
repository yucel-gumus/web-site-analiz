// Kırık bağlantı taraması: sayfadaki <a href> bağlantılarını tek tek dener.
// Yalnızca sunucudan gelen HTML taranır; JavaScript ile sonradan eklenen bağlantılar görülmez.
import { safeFetch as defaultSafeFetch } from '../safe-fetch.js';

const MAX_LINKS = 60;
const CONCURRENCY = 8;
const MAX_ITEMS = 10;
const SKIP = /^(#|mailto:|tel:|sms:|javascript:|data:|blob:|about:)/i;
// Bot korumaları bu kodlarla yanıt verir; bağlantı büyük olasılıkla çalışıyordur ama doğrulanamaz.
const UNVERIFIABLE = new Set([401, 403, 429, 999]);
// Bazı sunucular HEAD isteğini desteklemez; bu kodlarda GET ile yeniden denenir.
const RETRY_WITH_GET = new Set([400, 403, 404, 405, 501]);

const decode = (s) =>
  s.replace(/&amp;/g, '&').replace(/&#38;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();

export function extractLinks(html, baseUrl) {
  const re = /<a\b[^>]*?\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  const seen = new Set();
  const links = [];
  for (const m of html.matchAll(re)) {
    const raw = decode(m[1] ?? m[2] ?? m[3] ?? '');
    if (!raw || SKIP.test(raw)) continue;
    let url;
    try {
      url = new URL(raw, baseUrl);
    } catch {
      continue;
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    links.push(url.href);
  }
  return links;
}

async function checkLink(url, safeFetch) {
  try {
    let res = await safeFetch(url, { method: 'HEAD' });
    if (RETRY_WITH_GET.has(res.status)) res = await safeFetch(url, { method: 'GET' });
    return { url, status: res.status, redirects: res.redirects ?? [] };
  } catch (e) {
    return { url, error: e.code ?? e.message };
  }
}

async function mapLimit(list, limit, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const i = next++;
        out[i] = await fn(list[i]);
      }
    }),
  );
  return out;
}

const ERROR_TEXT = {
  ENOTFOUND: 'alan adı bulunamadı',
  ECONNREFUSED: 'bağlantı reddedildi',
  ETIMEDOUT: 'zaman aşımı',
  ECONNRESET: 'bağlantı koptu',
  EBLOCKED: 'özel ağ adresine işaret ediyor',
  EREDIRECTS: 'çok fazla yönlendirme',
  CERT_HAS_EXPIRED: 'SSL sertifikası süresi dolmuş',
  ERR_TLS_CERT_ALTNAME_INVALID: 'SSL sertifikası alan adıyla uyuşmuyor',
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'SSL sertifika zinciri eksik',
};

export function summarizeLinks(results, { pageUrl, total }) {
  const origin = new URL(pageUrl).origin;
  const label = (r) => `${r.url} — ${new URL(r.url).origin === origin ? 'site içi' : 'harici'}`;
  const broken = results.filter((r) => r.status >= 400 && r.status < 500 && !UNVERIFIABLE.has(r.status));
  const server = results.filter((r) => r.status >= 500 && !UNVERIFIABLE.has(r.status)); // 999: LinkedIn bot koruması
  const failed = results.filter((r) => r.error);
  const unverifiable = results.filter((r) => UNVERIFIABLE.has(r.status));
  const redirected = results.filter((r) => r.status < 400 && r.redirects.length && new URL(r.url).origin === origin);
  const ok = results.filter((r) => r.status < 400);

  const group = (id, title, description, list, weight, item, score = 0) =>
    list.length
      ? [{ id: `links-${id}`, title, description, docsUrl: 'https://developers.google.com/search/docs/crawling-indexing/links-crawlable', score, scoreMode: 'binary', displayValue: `${list.length} bağlantı`, weight, savings: [], items: list.slice(0, MAX_ITEMS).map(item) }]
      : [];

  const issues = [
    ...group('broken', 'Kırık bağlantılar (4xx)', 'Bu bağlantılar sayfa bulunamadı veya erişim hatası döndürüyor. Kullanıcı deneyimini bozar ve arama motorları için tarama bütçesini boşa harcar.', broken, 10, (r) => `${label(r)}; durum: ${r.status}`),
    ...group('server', 'Sunucu hatası veren bağlantılar (5xx)', 'Hedef sunucu hata veriyor; geçici olabilir ama süreklilik gösteriyorsa bağlantı güncellenmeli.', server, 8, (r) => `${label(r)}; durum: ${r.status}`),
    ...group('failed', 'Erişilemeyen bağlantılar', 'Bağlantıya hiç ulaşılamadı (alan adı yok, zaman aşımı veya SSL hatası).', failed, 7, (r) => `${label(r)}; hata: ${ERROR_TEXT[r.error] ?? r.error}`),
    ...group('redirects', 'Yönlendirilen site içi bağlantılar', 'Site içi bağlantılar doğrudan son adrese gitmeli; her yönlendirme ek bir istek ve gecikme demektir.', redirected, 2, (r) => `${r.url}; ${r.redirects.join(' ; ')}`, 0.5),
    ...group('unverifiable', 'Doğrulanamayan bağlantılar (bot koruması)', 'Bu siteler otomatik istekleri engelliyor (401/403/429/999). Bağlantı büyük olasılıkla çalışıyordur; tarayıcıda elle kontrol et.', unverifiable, 1, (r) => `${label(r)}; durum: ${r.status}`, 0.5),
  ];

  const checked = results.length - unverifiable.length;
  return {
    id: 'links',
    label: 'Kırık Bağlantılar',
    source: 'SiteAnaliz bağlantı tarayıcısı',
    score: checked ? Math.round((100 * ok.length) / checked) : null,
    issues,
    note: `Sayfada ${total} benzersiz bağlantı bulundu, ${results.length} tanesi kontrol edildi${total > results.length ? ` (ilk ${results.length})` : ''}. ${ok.length} çalışıyor, ${broken.length + server.length + failed.length} sorunlu, ${unverifiable.length} doğrulanamadı. Skor, doğrulanabilen bağlantılardan çalışanların oranıdır. Yalnızca sunucudan gelen HTML taranır; JavaScript ile sonradan eklenen bağlantılar görülmez.`,
  };
}

export async function runLinkCheck(url, { safeFetch = defaultSafeFetch } = {}) {
  let page;
  try {
    page = await safeFetch(url, { method: 'GET', wantBody: true, timeoutMs: 20_000 });
  } catch (e) {
    throw Object.assign(new Error(`Sayfa indirilemedi (${ERROR_TEXT[e.code] ?? e.message}).`), { status: 422 });
  }
  if (page.status >= 400) throw Object.assign(new Error(`Sayfa ${page.status} durum kodu döndürdü; bağlantılar taranamadı.`), { status: 422 });
  const type = String(page.headers?.['content-type'] ?? '');
  if (type && !type.includes('html')) throw Object.assign(new Error(`Sayfa HTML değil (${type}).`), { status: 422 });

  const all = extractLinks(page.body ?? '', page.finalUrl ?? url);
  const results = await mapLimit(all.slice(0, MAX_LINKS), CONCURRENCY, (link) => checkLink(link, safeFetch));
  return summarizeLinks(results, { pageUrl: page.finalUrl ?? url, total: all.length });
}
