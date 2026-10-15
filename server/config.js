// Ortak yapılandırma: PageSpeed ve Gemini anahtarları.
// Önce ortam değişkenleri (yerel geçersiz kılma), sonra Firestore system_config/llm belgesi.
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const CONFIG_PROJECT = process.env.FIREBASE_PROJECT_ID || 'aimunazara';
const TTL_MS = 5 * 60_000;
const RETRY_MS = 30_000;

let cache = { value: null, expires: 0 };
let pending = null; // süresi dolunca eşzamanlı istekler tek Firestore okumasını paylaşır

async function loadFromFirestore() {
  const app = getApps()[0] ?? initializeApp({ projectId: CONFIG_PROJECT });
  const snap = await getFirestore(app).doc('system_config/llm').get();
  return {
    pagespeedKey: snap.get('pagespeed_api_key') || '',
    geminiKey: snap.get('gemini_api_key_primary') || snap.get('gemini_api_key_secondary') || '',
    model: snap.get('active_model') || '',
    temperature: snap.get('temperature'),
  };
}

export async function getConfig() {
  let base = { pagespeedKey: '', geminiKey: '', model: '', temperature: undefined };
  const needsFirestore = !(process.env.PSI_API_KEY && process.env.GEMINI_API_KEY);

  if (needsFirestore) {
    if (Date.now() < cache.expires && cache.value) {
      base = cache.value;
    } else {
      pending ??= loadFromFirestore()
        .then((value) => {
          cache = { value, expires: Date.now() + TTL_MS };
          return value;
        })
        .catch((e) => {
          console.error('yapılandırma yüklenemedi:', e.message);
          cache = { value: base, expires: Date.now() + RETRY_MS };
          return base;
        })
        .finally(() => {
          pending = null;
        });
      base = await pending;
    }
  }

  return {
    ...base,
    pagespeedKey: process.env.PSI_API_KEY || base.pagespeedKey,
    geminiKey: process.env.GEMINI_API_KEY || base.geminiKey,
    model: process.env.GEMINI_MODEL || base.model || 'gemini-3.8-flash',
  };
}
