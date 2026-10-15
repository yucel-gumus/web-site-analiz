// Denetim raporlarını bellekte kısa süre saklar. AI analizi istemciden gelen metni değil,
// burada saklanan raporu işler; böylece Gemini anahtarı keyfi içerikle kötüye kullanılamaz.
import crypto from 'node:crypto';

const TTL_MS = 15 * 60_000;
const MAX_ENTRIES = 200;
const entries = new Map();

export function saveReport(report) {
  const id = crypto.randomUUID();
  entries.set(id, { report, at: Date.now(), ai: null, aiPending: null });
  if (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
  return id;
}

export function getEntry(id) {
  const entry = entries.get(String(id));
  if (!entry) return null;
  if (Date.now() - entry.at > TTL_MS) {
    entries.delete(String(id));
    return null;
  }
  return entry;
}
