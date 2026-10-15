// "Havan Topu" oyununun saf fizik ve ekonomi mantığı. DOM'a bağlı değildir, Node ile test edilebilir.
// Birimler: piksel ve saniye. Ekranın üstü y=0, aşağı doğru artar.

export const DUNYA = { W: 800, H: 340, g: 300, topR: 5, hedefR: 16, mortarX: 140, namluBoyu: 30 };
const DT = 1 / 120; // sabit fizik adımı

export const YUKSELTMELER = [
  { id: 'barut', ad: 'Güçlü Barut', aciklama: 'Patlama yarıçapı +6 px', baz: 30, kat: 1.55, max: 10 },
  { id: 'nisangah', ad: 'Nişangâh', aciklama: 'Yörünge önizlemesi uzar', baz: 40, kat: 1.6, max: 8 },
  { id: 'aerodinamik', ad: 'Aerodinamik Mermi', aciklama: 'Rüzgârın etkisi %15 azalır', baz: 50, kat: 1.7, max: 5 },
  { id: 'otomatik', ad: 'Otomatik Avcı', aciklama: 'Saniyede +1 ms pasif gelir', baz: 25, kat: 1.4, max: Infinity },
];

export const RUTBELER = [
  { esik: 0, ad: 'Stajyer' },
  { esik: 100, ad: 'Çaylak Nişancı' },
  { esik: 500, ad: 'Topçu Onbaşı' },
  { esik: 2000, ad: 'Kıdemli Optimizasyoncu' },
  { esik: 10000, ad: 'Fener Ustası' },
  { esik: 50000, ad: 'Lighthouse Efsanesi' },
];

export const maliyet = (yukseltme, seviye) => Math.ceil(yukseltme.baz * yukseltme.kat ** seviye);
export const patlamaYaricapi = (seviye) => 34 + seviye * 6;
export const onizlemeNoktasi = (seviye) => 6 + seviye * 4;
export const ruzgarDirenci = (seviye) => Math.min(0.75, seviye * 0.15);
export const pasifGelir = (otomatikSeviye) => otomatikSeviye;

export function rutbe(toplamMs) {
  return [...RUTBELER].reverse().find((r) => toplamMs >= r.esik).ad;
}

// localStorage'dan gelen veriye güvenme: sayıları ve seviyeleri sınırla.
export function temizleKayit(ham) {
  const sayi = (x) => (Number.isFinite(Number(x)) ? Math.max(0, Number(x)) : 0);
  const seviyeler = {};
  for (const y of YUKSELTMELER) {
    seviyeler[y.id] = Math.min(y.max, Math.floor(sayi(ham?.seviyeler?.[y.id])));
  }
  return { ms: Math.floor(sayi(ham?.ms)), toplam: Math.floor(sayi(ham?.toplam)), seviyeler };
}

// --- Zorluk: isabet sayısına göre artar, böylece oyun hiç bitmez ---
export const zorluk = (isabet) => Math.floor(isabet / 4);
export const ruzgarMax = (z) => Math.min(70, 15 + z * 8);
export const hedefSayisi = (z) => Math.min(3, 1 + Math.floor(z / 3));
export const hareketGenligi = (z) => Math.min(60, Math.max(0, (z - 1) * 12));
export const seriCarpani = (seri) => Math.min(5, 1 + Math.floor(seri / 2));

// Uzaktaki hedef ve doğrudan isabet daha çok kazandırır.
export function puan(mesafe, dogrudan, seri) {
  return Math.round((10 + Math.floor(mesafe / 30)) * (dogrudan ? 1.5 : 1) * seriCarpani(seri));
}

// --- Arazi: iki sinüs + aradaki tepe (kavisli atış gerektirir) ---
export function yeniArazi(rnd = Math.random) {
  return {
    a1: 14 + rnd() * 26, f1: 0.008 + rnd() * 0.008, p1: rnd() * 6.28,
    a2: 6 + rnd() * 12, f2: 0.02 + rnd() * 0.02, p2: rnd() * 6.28,
    tepe: { x: 230 + rnd() * 170, h: 40 + rnd() * 60, w: 36 + rnd() * 30 },
  };
}

export function arazi(x, p) {
  let y = 250 - (p.a1 * Math.sin(x * p.f1 + p.p1) + p.a2 * Math.sin(x * p.f2 + p.p2));
  if (p.tepe) y -= p.tepe.h * Math.exp(-(((x - p.tepe.x) / p.tepe.w) ** 2));
  return Math.max(70, Math.min(300, y));
}

// --- Hedefler: yerde durur veya araziyi izleyerek sağa sola salınır ---
export function yeniHedefler(z, rnd = Math.random) {
  const adet = hedefSayisi(z);
  const genislik = 300 / adet;
  const genlik = hareketGenligi(z);
  return Array.from({ length: adet }, (_, i) => ({
    x0: 440 + (i + 0.2 + rnd() * 0.6) * genislik,
    genlik: genlik * (0.5 + rnd() * 0.5),
    hiz: 0.8 + rnd() * 1.2,
    faz: rnd() * 6.28,
  }));
}

export function hedefKonumu(h, t, p) {
  const x = h.x0 + h.genlik * Math.sin(h.hiz * t + h.faz);
  return { x, y: arazi(x, p) - DUNYA.hedefR };
}

// --- Mermi fiziği ---
export const hiz = (guc) => 120 + guc * 4.4; // güç 0..100 → 120..560 px/s

export function baslangic(mx, my, aciDerece, guc) {
  const a = (aciDerece * Math.PI) / 180;
  const v = hiz(guc);
  return {
    x: mx + Math.cos(a) * DUNYA.namluBoyu,
    y: my - Math.sin(a) * DUNYA.namluBoyu,
    vx: v * Math.cos(a),
    vy: -v * Math.sin(a),
  };
}

// Rüzgâr yatay ivmedir (px/s²); aerodinamik mermi etkisini azaltır.
export function adim(top, dt, ruzgar, direnc) {
  const vx = top.vx + ruzgar * (1 - direnc) * dt;
  const vy = top.vy + DUNYA.g * dt;
  return { x: top.x + vx * dt, y: top.y + vy * dt, vx, vy };
}

// Çarpışma yoksa null döner. Hedef çarpışması indeksiyle birlikte bildirilir.
export function carpisma(top, p, hedefler, t) {
  for (let i = 0; i < hedefler.length; i++) {
    const k = hedefKonumu(hedefler[i], t, p);
    if (Math.hypot(top.x - k.x, top.y - k.y) <= DUNYA.hedefR + DUNYA.topR) {
      return { tip: 'hedef', x: top.x, y: top.y, hedef: i };
    }
  }
  if (top.x < -20 || top.x > DUNYA.W + 20) return { tip: 'disari', x: top.x, y: top.y };
  const yer = arazi(top.x, p);
  if (top.y >= yer) return { tip: 'arazi', x: top.x, y: yer };
  return null;
}

// Patlamadan etkilenen hedeflerin indeksleri: yarıçap içindekiler + doğrudan isabet.
export function patlamaKurbanlari(c, hedefler, t, p, yaricap) {
  if (!c || c.tip === 'disari') return [];
  return hedefler
    .map((h, i) => ({ i, k: hedefKonumu(h, t, p) }))
    .filter(({ i, k }) => i === c.hedef || Math.hypot(k.x - c.x, k.y - c.y) <= yaricap)
    .map(({ i }) => i);
}

// Önizleme: ilk `nokta` örneği (her `aralik` saniyede bir), araziye çarpınca durur.
export function yorunge(baslangicTopu, ruzgar, direnc, nokta, p, aralik = 0.06) {
  const adimSayisi = Math.round(aralik / DT);
  const noktalar = [];
  let top = baslangicTopu;
  for (let n = 0; n < nokta * adimSayisi; n++) {
    top = adim(top, DT, ruzgar, direnc);
    if (top.y >= arazi(top.x, p)) break;
    if (n % adimSayisi === adimSayisi - 1) noktalar.push({ x: top.x, y: top.y });
  }
  return noktalar;
}

// Tam atışı baştan sona simüle eder (testler ve doğrulama için).
export function simule(top, ruzgar, direnc, p, hedefler = [], t = 0, azamiSaniye = 20) {
  let mevcut = top;
  for (let n = 0; n < azamiSaniye / DT; n++) {
    mevcut = adim(mevcut, DT, ruzgar, direnc);
    const c = carpisma(mevcut, p, hedefler, t + n * DT);
    if (c) return c;
  }
  return null;
}
