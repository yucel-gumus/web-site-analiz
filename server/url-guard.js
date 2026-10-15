// Kullanıcının girdiği URL'leri PageSpeed Insights'a göndermeden önce doğrular.
// Yalnızca herkese açık http(s) adreslerine izin verilir (temel SSRF koruması).

const PRIVATE_V4 = [
  /^0\./,
  /^10\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10
  /^127\./,
  /^169\.254\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.0\.0\./,
  /^192\.168\./,
  /^198\.1[89]\./, // kıyaslama ağı 198.18.0.0/15
  /^(22[4-9]|2[3-5]\d)\./, // çoklu yayın ve ayrılmış blok
];

export const isPrivateIPv4 = (ip) => PRIVATE_V4.some((re) => re.test(ip)) || ip === '255.255.255.255';

// DNS çözümlemesinden dönen gerçek adres için (kırık bağlantı taramasında sunucu kendisi istek atar).
export function isPrivateIp(ip) {
  const a = String(ip).toLowerCase();
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(a)) return isPrivateIPv4(a);
  const mapped = a.match(/^::ffff:(\d{1,3}(\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return (
    a === '::' ||
    a === '::1' ||
    /^f[cd]/.test(a) || // fc00::/7 benzersiz yerel
    /^fe[89ab]/.test(a) || // fe80::/10 bağlantı yerel
    /^ff/.test(a) || // çoklu yayın
    a.startsWith('64:ff9b:') || // NAT64
    a.startsWith('2001:db8:') // dokümantasyon
  );
}

export function parseTargetUrl(input) {
  let raw = String(input ?? '').trim();
  if (!raw) throw new Error('URL boş olamaz.');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Geçersiz URL.');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Sadece http ve https adresleri desteklenir.');
  }
  if (url.username || url.password) {
    throw new Error('URL içinde kullanıcı adı veya şifre olamaz.');
  }

  // 'localhost.' gibi sondaki noktalı tam ad biçimi aynı makineyi gösterir; karşılaştırmadan önce at.
  const host = url.hostname.toLowerCase().replace(/\.+$/, '');
  const isIpv6 = host.startsWith('[');
  const isIpv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const blocked =
    !host ||
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    isIpv6 ||
    (isIpv4 && isPrivateIPv4(host)) ||
    (!isIpv4 && !host.includes('.'));
  if (blocked) throw new Error('Yerel veya özel ağ adreslerine izin verilmiyor.');

  return url;
}
