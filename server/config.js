// Ortak yapılandırma: PageSpeed ve Gemini anahtarları, aktif model ve düşünme seviyesi.
// Öncelik (FIRESTORE_CONFIG_ENABLED !== 'false'): Firebase Firestore `aimunazara` (`system_config/llm` + `system_config/site_analiz`, 60s TTL).
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const CONFIG_PROJECT = process.env.FIREBASE_PROJECT_ID || 'aimunazara';
const TTL_MS = 60_000;
const RETRY_MS = 10_000;

const DEFAULT_FALLBACK_MODELS = ['gemini-4-hydrogen', 'gemini-4-argon'];
const DEFAULT_CORS_ORIGINS = ['https://site-analiz.web.app', 'https://site-analiz.firebaseapp.com'];

let cache = { value: null, expires: 0 };
let pending = null; // süresi dolunca eşzamanlı istekler tek Firestore okumasını paylaşır

function pickStr(snap, field) {
  const val = snap?.exists ? snap.get(field) : undefined;
  return typeof val === 'string' && val.trim() ? val.trim() : '';
}

function pickStrList(snap, field) {
  const val = snap?.exists ? snap.get(field) : undefined;
  if (Array.isArray(val)) {
    const cleaned = val.map((x) => (typeof x === 'string' ? x.trim() : '')).filter(Boolean);
    if (cleaned.length > 0) return cleaned;
  }
  return [];
}

function envGeminiKeys() {
  const seen = new Set();
  const keys = [];
  for (const k of [process.env.GEMINI_API_KEY_1, process.env.GEMINI_API_KEY_2, process.env.GEMINI_API_KEY]) {
    if (typeof k === 'string' && k.trim() && !seen.has(k.trim())) {
      seen.add(k.trim());
      keys.push(k.trim());
    }
  }
  return keys;
}

async function loadFromFirestore() {
  const app = getApps().find((a) => a.name === '[DEFAULT]') ?? initializeApp({ projectId: CONFIG_PROJECT });
  const db = getFirestore(app);
  const [llmSnap, siteSnap] = await Promise.all([
    db.doc('system_config/llm').get(),
    db.doc('system_config/site_analiz').get(),
  ]);

  const fsKeys = [];
  for (const field of ['gemini_api_key_primary', 'gemini_api_key_secondary']) {
    const k = pickStr(llmSnap, field);
    if (k && !fsKeys.includes(k)) fsKeys.push(k);
  }

  const fbSite = pickStrList(siteSnap, 'fallback_models');
  const fbLlm = pickStrList(llmSnap, 'fallback_models');
  const origins = pickStrList(siteSnap, 'cors_origins');

  return {
    pagespeedKey: pickStr(llmSnap, 'pagespeed_api_key'),
    geminiKeys: fsKeys,
    model: pickStr(siteSnap, 'active_model') || pickStr(llmSnap, 'active_model'),
    thinkingLevel: pickStr(siteSnap, 'thinking_level') || pickStr(llmSnap, 'active_thinking_level'),
    fallbackModels: fbSite.length ? fbSite : fbLlm,
    temperature: llmSnap.exists ? llmSnap.get('temperature') : undefined,
    corsOrigins: origins,
  };
}

export function getCachedCorsOrigins() {
  return cache.value?.corsOrigins?.length ? cache.value.corsOrigins : null;
}

export async function getConfig() {
  const envKeys = envGeminiKeys();
  let base = {
    pagespeedKey: '',
    geminiKeys: [],
    model: '',
    thinkingLevel: '',
    fallbackModels: [],
    temperature: undefined,
    corsOrigins: [],
  };

  const firestoreEnabled = (process.env.FIRESTORE_CONFIG_ENABLED ?? 'true').trim().toLowerCase() !== 'false';
  if (firestoreEnabled) {
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
          const fallback = cache.value || base;
          cache = { value: fallback, expires: Date.now() + RETRY_MS };
          return fallback;
        })
        .finally(() => {
          pending = null;
        });
      base = await pending;
    }
  }

  const geminiKeys = base.geminiKeys?.length ? base.geminiKeys : envKeys;
  const fallbackModels = base.fallbackModels?.length ? base.fallbackModels : DEFAULT_FALLBACK_MODELS;
  const corsOriginsList = base.corsOrigins?.length ? base.corsOrigins : DEFAULT_CORS_ORIGINS;

  return {
    pagespeedKey: base.pagespeedKey || process.env.PSI_API_KEY || '',
    geminiKeys,
    geminiKey: geminiKeys[0] || '',
    model: base.model || process.env.GEMINI_MODEL || 'gemini-4-carbon',
    thinkingLevel: (base.thinkingLevel || 'high').toLowerCase(),
    fallbackModels,
    temperature: base.temperature,
    corsOrigins: corsOriginsList,
  };
}
