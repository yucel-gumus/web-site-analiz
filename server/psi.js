// PageSpeed Insights (Lighthouse) istemcisi ve yanıt normalleştirici.
import { normalizeCruxFromPsi } from './checks/crux.js';

const PSI_ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';
const PSI_TIMEOUT_MS = 170_000; // ağır sitelerde Lighthouse 2 dakikayı aşabilir

export const CATEGORIES = [
  { id: 'performance', label: 'Performance' },
  { id: 'accessibility', label: 'Accessibility' },
  { id: 'best-practices', label: 'Best Practices' },
  { id: 'seo', label: 'SEO' },
];

export const ALL_CATEGORIES = CATEGORIES.map((c) => c.id);

const MAX_ITEMS = 5;
// Lighthouse 11+ fırsat/teşhis/insight denetimlerini 'metricSavings' modunda puanlar.
const SCORED_MODES = new Set(['binary', 'numeric', 'metricSavings']);

// Önce ağırlık, eşitlikte düşük skor: hem rapor hem AI seçimi bu sırayı kullanır.
export const byImpact = (a, b) => b.weight - a.weight || a.score - b.score;

function cleanDescription(text = '') {
  const links = [];
  const plain = text
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, (_, label, href) => {
      links.push(href);
      return label;
    })
    .replace(/`/g, '')
    .trim();
  return { text: plain, docsUrl: links[0] ?? null };
}

const kib = (bytes) => `${Math.round(bytes / 1024)} KiB`;
const oneLine = (text, max) => String(text).replace(/\s+/g, ' ').trim().slice(0, max);

// axe açıklamaları satır satır gelir ve "Fix any of the following:" gibi başlıklar içerir; bunları ayıklayıp
// kontrolleri "; " ile birleştirir ve kelime ortasında kesmeden kısaltır.
function cleanExplanation(text, max = 320) {
  const parts = String(text)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter((line) => line && !/^fix (any|all|one) of the following:?$/i.test(line))
    .map((line) => line.replace(/^fix (any|all|one) of the following:\s*/i, ''));
  const joined = oneLine(parts.join('; '), Infinity);
  if (joined.length <= max) return joined;
  const cut = joined.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), max * 0.6))}…`;
}

// Her öğe: sorunlu kod/URL + varsa seçici, boyut, israf ve Lighthouse'un açıklaması (ör. kontrast oranı).
function describeItem(item) {
  const node = item.node ?? item.subItems?.items?.[0]?.node;
  const base = node?.snippet || item.url || item.source?.url;
  if (!base || typeof base !== 'string') return null;
  const extras = [];
  if (node?.selector) extras.push(`seçici: ${oneLine(node.selector, 120)}`);
  if (typeof item.totalBytes === 'number') extras.push(`boyut: ${kib(item.totalBytes)}`);
  if (typeof item.wastedBytes === 'number' && item.wastedBytes > 0) extras.push(`gereksiz: ${kib(item.wastedBytes)}`);
  if (typeof item.wastedMs === 'number' && item.wastedMs > 0) extras.push(`gecikme: ~${Math.round(item.wastedMs)} ms`);
  if (node?.explanation) extras.push(cleanExplanation(node.explanation));
  const head = oneLine(base, 300);
  return extras.length ? `${head} — ${extras.join('; ')}` : head;
}

function extractItems(audit) {
  const items = audit.details?.items;
  if (!Array.isArray(items)) return [];
  // Aynı öğe birden çok kez raporlanabilir (ör. bir listedeki benzer <span>'ler); tek satırda sayısıyla göster.
  const counts = new Map();
  for (const line of items.map(describeItem).filter(Boolean)) counts.set(line, (counts.get(line) ?? 0) + 1);
  return [...counts]
    .slice(0, MAX_ITEMS)
    .map(([line, n]) => (n > 1 ? `${line} (×${n})` : line));
}

// Lighthouse 11+ denetimleri hangi metriği ne kadar iyileştireceğini metricSavings içinde verir.
function extractSavings(audit) {
  return Object.entries(audit.metricSavings ?? {})
    .filter(([, v]) => typeof v === 'number' && v > 0)
    .map(([metric, v]) => (metric === 'CLS' ? `CLS −${v.toFixed(3)}` : `${metric} ~${Math.round(v)} ms`));
}

// stackPacks yalnızca bazı platformları tanır; kaynak URL'lerinden yaygın framework izlerini de çıkar.
const STACK_HINTS = [
  [/\/_next\//, 'Next.js'],
  [/\/_nuxt\//, 'Nuxt'],
  [/\/wp-(content|includes)\//, 'WordPress'],
  [/cdn\.shopify\.com/, 'Shopify'],
  [/\/_astro\//, 'Astro'],
  [/\/static\/js\/main\.[0-9a-f]+\.js/, 'Create React App'],
  [/id="__next"|data-nextjs/, 'Next.js'],
  // Tailwind'e özgü keyfi değer (text-[#fff]/85) ve duyarlı önek (md:col-span-2) sınıfları
  [/class="[^"]*(?:\b[a-z-]+-\[[^\]\s]+\]|\b(?:sm|md|lg|xl|2xl|hover|focus):[a-z])/, 'Tailwind CSS'],
];

function detectStacks(lhr) {
  const found = new Set((lhr.stackPacks ?? []).map((s) => s.title).filter(Boolean));
  const traces = []; // kaynak URL'leri ve HTML parçaları
  for (const audit of Object.values(lhr.audits ?? {})) {
    const items = audit?.details?.items;
    if (!Array.isArray(items)) continue; // bazı denetimlerde items dizi değil, nesnedir
    for (const item of items) {
      if (typeof item?.url === 'string') traces.push(item.url);
      const snippet = item?.node?.snippet ?? item?.subItems?.items?.[0]?.node?.snippet;
      if (typeof snippet === 'string') traces.push(snippet); // hızlı modda URL yok; HTML parçaları da iz taşır
    }
  }
  for (const [re, name] of STACK_HINTS) if (traces.some((t) => re.test(t))) found.add(name);
  return [...found];
}

export function normalizeLighthouse(lhr) {
  // Yalnızca istenen (yanıtta bulunan) kategoriler raporlanır; hızlı modda performans yoktur.
  const categories = CATEGORIES.filter(({ id }) => lhr.categories?.[id]).map(({ id, label }) => {
    const cat = lhr.categories?.[id];
    const issues = (cat?.auditRefs ?? [])
      .map((ref) => ({ ref, audit: lhr.audits?.[ref.id] }))
      .filter(
        ({ audit }) =>
          audit &&
          typeof audit.score === 'number' &&
          audit.score < 0.9 &&
          SCORED_MODES.has(audit.scoreDisplayMode),
      )
      .map(({ ref, audit }) => {
        const { text, docsUrl } = cleanDescription(audit.description);
        return {
          id: audit.id,
          title: String(audit.title ?? '').replace(/`/g, '').trim(),
          description: text,
          docsUrl,
          score: audit.score,
          scoreMode: audit.scoreDisplayMode,
          displayValue: audit.displayValue ?? null,
          weight: ref.weight ?? 0,
          savings: extractSavings(audit),
          items: extractItems(audit),
        };
      })
      .sort(byImpact);

    return {
      id,
      label,
      score: cat?.score == null ? null : Math.round(cat.score * 100),
      issues,
    };
  });

  return {
    finalUrl: lhr.finalDisplayedUrl ?? lhr.finalUrl ?? lhr.requestedUrl,
    fetchedAt: lhr.fetchTime,
    stacks: detectStacks(lhr),
    warnings: (lhr.runWarnings ?? []).map(String).slice(0, 5),
    categories,
  };
}

export async function runAudit(url, { strategy = 'mobile', apiKey, categories = ALL_CATEGORIES } = {}) {
  const params = new URLSearchParams({ url, strategy, locale: 'tr' });
  for (const id of categories) params.append('category', id);
  if (apiKey) params.set('key', apiKey);

  let res;
  try {
    res = await fetch(`${PSI_ENDPOINT}?${params}`, { signal: AbortSignal.timeout(PSI_TIMEOUT_MS) });
  } catch (e) {
    const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError';
    const err = new Error(
      timedOut
        ? 'Analiz çok uzun sürdü ve zaman aşımına uğradı. Site yavaş veya Lighthouse\'a geç yanıt veriyor olabilir. Tekrar dene ya da başka bir sayfa dene.'
        : 'PageSpeed servisine ulaşılamadı. İnternet bağlantını kontrol edip tekrar dene.',
    );
    err.status = timedOut ? 504 : 502;
    throw err;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const quota = res.status === 429;
    const crashed = (body?.error?.errors ?? []).some((e) => e.reason === 'lighthouseError');
    let message;
    if (quota) {
      message = 'PageSpeed API kotası doldu. Sunucuya ücretsiz bir PSI_API_KEY ekle veya daha sonra tekrar dene.';
    } else if (crashed) {
      message =
        'Lighthouse bu sayfayı analiz edemedi. Sayfa çok ağır olabilir (ör. 3B/WebGL, çok fazla script) ya da Lighthouse\'ı engelliyor olabilir. Mobil/Masaüstü seçimini değiştirmeyi, biraz sonra tekrar denemeyi veya daha hafif bir sayfayı (ör. ana sayfa) analiz etmeyi dene.';
    } else {
      message = body?.error?.message ?? `PageSpeed API hatası (${res.status})`;
    }
    const err = new Error(message);
    err.status = quota ? 429 : crashed ? 422 : 502;
    throw err;
  }
  if (!body.lighthouseResult) throw new Error('PageSpeed yanıtında Lighthouse sonucu yok.');
  const runtimeError = body.lighthouseResult.runtimeError;
  if (runtimeError?.code && runtimeError.code !== 'NO_ERROR') {
    const err = new Error(
      `Lighthouse sayfayı yükleyemedi (${runtimeError.code}). Sayfa boş görünüyor, çok yavaş açılıyor veya hata döndürüyor olabilir. Adresi kontrol edip tekrar dene.`,
    );
    err.status = 422;
    throw err;
  }
  // Aynı yanıt gerçek kullanıcı (CrUX) verisini de taşır; ek istek gerekmez.
  return { ...normalizeLighthouse(body.lighthouseResult), crux: normalizeCruxFromPsi(body.loadingExperience, body.originLoadingExperience) };
}
