// Sunucunun kendisinin dış adreslere istek attığı tek yol (kırık bağlantı taraması).
// SSRF koruması: her bağlantıda DNS sonucu kontrol edilir (yönlendirmeler dahil); özel ağ IP'lerine bağlanılmaz.
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import { parseTargetUrl, isPrivateIp } from './url-guard.js';

// HTTP başlıkları yalnızca ASCII olabilir.
const USER_AGENT = 'Mozilla/5.0 (compatible; SiteAnaliz/2.0; link checker)';
const MAX_REDIRECTS = 5;

const blocked = () => Object.assign(new Error('Özel ağ adresine bağlantı engellendi.'), { code: 'EBLOCKED' });

// Bağlantının gerçekten kurulacağı adres burada doğrulanır; böylece DNS yeniden bağlama (rebinding) da engellenir.
export function guardedLookup(hostname, options, callback) {
  const opts = typeof options === 'object' && options ? options : {};
  dns.lookup(hostname, { all: true, family: opts.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) return callback(blocked());
    if (opts.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function requestOnce(url, { method, timeoutMs, maxBytes, wantBody }) {
  return new Promise((resolve, reject) => {
    const mod = url.protocol === 'https:' ? https : http;
    let settled = false;
    const done = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(value);
    };
    const req = mod.request(
      url,
      { method, lookup: guardedLookup, headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8' } },
      (res) => {
        const head = { status: res.statusCode, headers: res.headers };
        if (!wantBody) {
          res.destroy();
          return done(resolve, head);
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            return done(resolve, { ...head, body: Buffer.concat(chunks).toString('utf8'), truncated: true });
          }
          chunks.push(chunk);
        });
        res.on('end', () => done(resolve, { ...head, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (e) => done(reject, e));
      },
    );
    // Toplam süre sınırı (yalnızca boşta kalma değil): yavaş akan yanıtlar da kesilir.
    const timer = setTimeout(() => req.destroy(Object.assign(new Error('zaman aşımı'), { code: 'ETIMEDOUT' })), timeoutMs);
    req.on('error', (e) => done(reject, e));
    req.end();
  });
}

export async function safeFetch(input, { method = 'GET', timeoutMs = 10_000, maxBytes = 3_000_000, wantBody = false } = {}) {
  let current = input;
  const chain = [];
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let url;
    try {
      url = parseTargetUrl(current); // ad tabanlı kurallar (localhost., .internal, özel IP yazımı)
    } catch {
      throw blocked();
    }
    const res = await requestOnce(url, { method, timeoutMs, maxBytes, wantBody });
    if (res.status >= 300 && res.status < 400 && res.headers.location) {
      chain.push(`${res.status} → ${res.headers.location}`);
      current = new URL(res.headers.location, url).href;
      continue;
    }
    return { ...res, finalUrl: url.href, redirects: chain };
  }
  throw Object.assign(new Error('Çok fazla yönlendirme.'), { code: 'EREDIRECTS' });
}
