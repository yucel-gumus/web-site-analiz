// W3C Nu HTML Checker: sayfanın HTML'ini standarda göre doğrular. Sayfayı W3C sunucusu indirir.

const API = 'https://validator.w3.org/nu/';
// HTTP başlıkları yalnızca ASCII olabilir.
const USER_AGENT = 'SiteAnaliz/2.0 (web site audit tool)';
const MAX_ISSUES = 25;
const MAX_ITEMS = 5;

const kind = (m) => (m.type === 'error' ? 'error' : m.type === 'info' && m.subType === 'warning' ? 'warning' : null);

// Aynı mesaj çok kez tekrarlanır (ör. her <meta/> için); mesaj metnine göre gruplanır.
export function normalizeW3c(body) {
  const messages = body?.messages ?? [];
  const fatal = messages.find((m) => m.type === 'non-document-error');
  if (fatal) {
    throw Object.assign(new Error(`W3C doğrulayıcı sayfayı indiremedi: ${fatal.message}`), { status: 422 });
  }
  const groups = new Map();
  for (const m of messages) {
    const k = kind(m);
    if (!k) continue; // salt bilgi mesajları (ör. "trailing slash") gürültüdür
    const key = `${k}:${m.message}`;
    const g = groups.get(key) ?? { kind: k, message: m.message, count: 0, items: [] };
    g.count += 1;
    if (g.items.length < MAX_ITEMS) {
      const line = m.lastLine ?? m.firstLine;
      g.items.push(`${line ? `satır ${line}: ` : ''}${String(m.extract ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)}`);
    }
    groups.set(key, g);
  }
  const list = [...groups.values()].sort((a, b) => (a.kind === b.kind ? b.count - a.count : a.kind === 'error' ? -1 : 1));
  const errors = list.filter((g) => g.kind === 'error');
  const warnings = list.filter((g) => g.kind === 'warning');
  const errorCount = errors.reduce((n, g) => n + g.count, 0);
  const warningCount = warnings.reduce((n, g) => n + g.count, 0);

  const issues = list.slice(0, MAX_ISSUES).map((g, i) => ({
    id: `w3c-${i + 1}`,
    title: `${g.kind === 'error' ? 'Hata' : 'Uyarı'}: ${g.message.slice(0, 160)}`,
    description: g.message,
    docsUrl: 'https://html.spec.whatwg.org/multipage/',
    score: g.kind === 'error' ? 0 : 0.5,
    scoreMode: 'binary',
    displayValue: `${g.count} kez`,
    weight: (g.kind === 'error' ? 3 : 1) * Math.min(g.count, 10),
    savings: [],
    items: g.items.filter(Boolean),
  }));

  return {
    id: 'html',
    label: 'HTML Doğrulama',
    source: 'W3C Nu HTML Checker',
    // W3C bir skor vermez; bu değer SiteAnaliz'in farklı hata/uyarı türü sayısından ürettiği bir göstergedir.
    score: Math.max(0, 100 - errors.length * 8 - warnings.length * 2),
    issues,
    note: `W3C sonucu: ${errorCount} hata (${errors.length} farklı tür), ${warningCount} uyarı (${warnings.length} farklı tür). Skor W3C'nin değil, SiteAnaliz'in farklı hata/uyarı türü sayısından ürettiği bir göstergedir. Salt bilgi mesajları gösterilmez.${list.length > MAX_ISSUES ? ` İlk ${MAX_ISSUES} tür listelendi.` : ''}`,
  };
}

export async function runW3c(url, { fetchFn = fetch } = {}) {
  const res = await fetchFn(`${API}?${new URLSearchParams({ out: 'json', doc: url })}`, {
    headers: { 'user-agent': USER_AGENT },
    signal: AbortSignal.timeout(90_000),
  });
  const body = await res.json().catch(() => null);
  if (res.status === 429) throw Object.assign(new Error('W3C doğrulayıcı istek sınırına ulaştı. Biraz sonra tekrar dene.'), { status: 429 });
  if (!res.ok || !body) throw Object.assign(new Error(`W3C doğrulayıcı yanıt vermedi (${res.status}).`), { status: 502 });
  return normalizeW3c(body);
}
