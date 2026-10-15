// Qualys SSL Labs: TLS yapılandırması, sertifika ve bilinen açıklar. Taramayı SSL Labs sunucuları yapar.
// Yeni tarama 1–4 dakika sürebilir; son 24 saatlik önbellek varsa anında döner. Sonuçlar herkese açık panoda yayınlanmaz.

const API = 'https://api.ssllabs.com/api/v3/analyze';
const POLL_MS = 8_000;
const DEADLINE_MS = 240_000;
const DAY = 86_400_000;
const LONG_HSTS = 15_552_000; // 180 gün: SSL Labs'ın "uzun" kabul ettiği alt sınır

const GRADE_SCORE = { 'A+': 100, A: 95, 'A-': 90, B: 80, C: 70, D: 60, E: 50, F: 30, T: 20, M: 20 };

const VULNS = [
  ['heartbleed', (d) => d.heartbleed === true, 'Heartbleed'],
  ['poodle', (d) => d.poodle === true, 'POODLE (SSL 3)'],
  ['poodle-tls', (d) => d.poodleTls === 2, 'POODLE (TLS)'],
  ['freak', (d) => d.freak === true, 'FREAK'],
  ['logjam', (d) => d.logjam === true, 'Logjam'],
  ['drown', (d) => d.drownVulnerable === true, 'DROWN'],
  ['ccs', (d) => d.openSslCcs >= 2, 'OpenSSL CCS (CVE-2014-0224)'],
  ['lucky13', (d) => d.openSSLLuckyMinus20 === 2, 'OpenSSL Padding Oracle (CVE-2016-2107)'],
  ['ticketbleed', (d) => d.ticketbleed === 2, 'Ticketbleed'],
  ['robot', (d) => d.bleichenbacher >= 2, 'ROBOT (Bleichenbacher)'],
  ['zombie-poodle', (d) => d.zombiePoodle >= 2, 'Zombie POODLE'],
  ['golden-doodle', (d) => d.goldenDoodle >= 4, 'GOLDENDOODLE'],
];

const ipOf = (e) => e.ipAddress ?? e.serverName ?? 'bilinmeyen sunucu';

function issue(id, title, description, weight, items, docsUrl = null) {
  return { id: `ssl-${id}`, title, description, docsUrl, score: 0, scoreMode: 'binary', displayValue: `${items.length} sunucuda`, weight, savings: [], items };
}

export function normalizeSslLabs(result, now = Date.now()) {
  if (result?.status === 'ERROR') {
    throw Object.assign(new Error(`SSL Labs taraması başarısız: ${result.statusMessage ?? 'bilinmeyen hata'}. Site HTTPS (443) üzerinden erişilebilir olmalı.`), { status: 422 });
  }
  const endpoints = (result?.endpoints ?? []).filter((e) => e.details || e.grade);
  if (!endpoints.length) {
    const msg = result?.endpoints?.[0]?.statusMessage ?? 'sunucuya bağlanılamadı';
    throw Object.assign(new Error(`SSL Labs sonuç üretemedi: ${msg}.`), { status: 422 });
  }

  const issues = [];
  const where = (pred) => endpoints.filter((e) => e.details && pred(e.details)).map(ipOf);

  const ungraded = endpoints.filter((e) => e.grade && e.grade !== 'A+');
  if (ungraded.length) {
    issues.push(issue('grade', 'Bazı sunucular A+ notunun altında', 'Siteye yanıt veren her IP adresi ayrı değerlendirilir; kullanıcılar hangi sunucuya düşerse onun yapılandırmasını görür. Tüm sunucuların aynı TLS ve başlık yapılandırmasını kullanması gerekir.', 6, ungraded.map((e) => `${ipOf(e)} — not: ${e.grade}${e.hasWarnings ? ' (uyarılı)' : ''}`)));
  }
  const noHsts = where((d) => d.hstsPolicy?.status !== 'present');
  if (noHsts.length) {
    issues.push(issue('hsts-missing', 'HSTS başlığı eksik', 'Strict-Transport-Security başlığı olmadan tarayıcı ilk isteği HTTP ile yapabilir; bu, araya girme (SSL stripping) saldırısına açık bırakır. A+ notu için tüm sunucularda en az 180 günlük HSTS gerekir.', 8, noHsts, 'https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Strict-Transport-Security'));
  }
  const shortHsts = where((d) => d.hstsPolicy?.status === 'present' && (d.hstsPolicy.maxAge ?? 0) < LONG_HSTS);
  if (shortHsts.length) {
    issues.push(issue('hsts-short', 'HSTS süresi kısa', 'max-age değeri 180 günden (15552000 sn) kısa; SSL Labs A+ için uzun süreli HSTS ister.', 4, shortHsts));
  }
  const oldProtocols = endpoints.flatMap((e) =>
    (e.details?.protocols ?? [])
      .filter((p) => p.name === 'SSL' || (p.name === 'TLS' && Number(p.version) < 1.2))
      .map((p) => `${ipOf(e)} — ${p.name} ${p.version}`),
  );
  if (oldProtocols.length) {
    issues.push(issue('old-protocols', 'Eski ve güvensiz protokoller açık', 'SSL 3, TLS 1.0 ve TLS 1.1 kullanımdan kaldırılmıştır ve bilinen zayıflıkları vardır. Yalnızca TLS 1.2 ve TLS 1.3 açık kalmalıdır.', 9, oldProtocols));
  }
  const noTls13 = where((d) => !(d.protocols ?? []).some((p) => p.name === 'TLS' && p.version === '1.3'));
  if (noTls13.length) {
    issues.push(issue('no-tls13', 'TLS 1.3 desteklenmiyor', 'TLS 1.3 daha hızlı bağlantı kurulumu (1-RTT) ve daha güçlü şifreleme sunar.', 3, noTls13));
  }
  for (const [id, test, name] of VULNS) {
    const hit = where(test);
    if (hit.length) issues.push(issue(`vuln-${id}`, `Bilinen açık: ${name}`, `Sunucu ${name} açığına karşı savunmasız görünüyor. Sunucu/TLS kütüphanesi güncellenmeli veya ilgili özellik kapatılmalı.`, 10, hit));
  }
  const rc4 = where((d) => d.supportsRc4);
  if (rc4.length) issues.push(issue('rc4', 'RC4 şifrelemesi destekleniyor', 'RC4 kırılmış bir şifrelemedir ve kapatılmalıdır.', 8, rc4));
  // forwardSecrecy bit maskesi: 1 = bazı istemciler, 2 = modern tarayıcılar, 4 = tüm istemciler (en güçlü).
  const weakFs = where((d) => typeof d.forwardSecrecy === 'number' && (d.forwardSecrecy & 6) === 0);
  if (weakFs.length) issues.push(issue('forward-secrecy', 'İleri gizlilik (forward secrecy) modern tarayıcılarda sağlanmıyor', 'ECDHE tabanlı şifre takımları öncelikli olmalı; aksi halde ele geçirilen özel anahtar geçmiş trafiğin çözülmesine yol açar.', 6, weakFs));

  const cert = result.certs?.[0];
  if (cert?.notAfter) {
    const days = Math.floor((cert.notAfter - now) / DAY);
    if (days < 30) {
      issues.push(issue('cert-expiry', days < 0 ? 'Sertifikanın süresi dolmuş' : 'Sertifikanın süresi yakında doluyor', `Sertifika (${cert.subject}) ${days < 0 ? `${-days} gün önce` : `${days} gün içinde`} sona eriyor. Otomatik yenileme (ör. Let's Encrypt/ACME) yapılandırması kontrol edilmeli.`, days < 0 ? 10 : 7, [`${cert.subject} — veren: ${cert.issuerSubject ?? '?'}`]));
    }
  }
  if (cert && cert.issues) {
    issues.push(issue('cert-issues', 'Sertifika zinciri veya geçerlilik sorunu', 'SSL Labs sertifikada sorun buldu (zincir eksik, ad uyuşmazlığı, iptal veya güvenilmeyen kök olabilir). Tarayıcılar uyarı gösterebilir.', 10, [`${cert.subject} — sorun kodu: ${cert.issues}`]));
  }

  const grades = endpoints.map((e) => e.grade).filter(Boolean);
  const score = grades.length ? Math.min(...grades.map((g) => GRADE_SCORE[g] ?? 0)) : null;
  const certNote = cert?.notAfter ? ` Sertifika (${cert.subject}, veren: ${cert.issuerSubject ?? '?'}) ${new Date(cert.notAfter).toISOString().slice(0, 10)} tarihine kadar geçerli.` : '';
  return {
    id: 'ssl',
    label: 'SSL/TLS',
    source: 'Qualys SSL Labs',
    score,
    issues: issues.sort((a, b) => b.weight - a.weight),
    note: `SSL Labs notu: ${endpoints.map((e) => `${e.grade ?? '?'} (${ipOf(e)})`).join(', ')}. Skor en düşük nota göre hesaplanır.${certNote}`,
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSslLabs(url, { fetchFn = fetch, pollMs = POLL_MS, deadlineMs = DEADLINE_MS } = {}) {
  const host = new URL(url).hostname;
  const query = (extra) =>
    fetchFn(`${API}?${new URLSearchParams({ host, publish: 'off', all: 'done', ...extra })}`, { signal: AbortSignal.timeout(30_000) }).then(async (res) => {
      if (res.status === 429 || res.status === 529 || res.status === 503) {
        throw Object.assign(new Error('SSL Labs şu an çok yoğun. Birkaç dakika sonra tekrar dene.'), { status: 503 });
      }
      const body = await res.json().catch(() => null);
      if (!res.ok || !body) throw Object.assign(new Error(`SSL Labs yanıt vermedi (${res.status}).`), { status: 502 });
      return body;
    });

  const start = Date.now();
  let result = await query({ fromCache: 'on', maxAge: '24' });
  while (result.status !== 'READY' && result.status !== 'ERROR') {
    if (Date.now() - start > deadlineMs) {
      throw Object.assign(new Error('SSL Labs taraması 4 dakikada bitmedi. Tarama arka planda sürüyor; birkaç dakika sonra tekrar dene (sonuç önbellekten hızlı gelir).'), { status: 504 });
    }
    await sleep(pollMs);
    result = await query({});
  }
  return normalizeSslLabs(result);
}
