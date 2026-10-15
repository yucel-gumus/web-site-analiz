// Analiz beklenirken oynanan "Havan Topu" oyunu (canvas). Analiz bitince durur; ilerleme tarayıcıda saklanır.
import { el } from './dom.js';
import {
  DUNYA, YUKSELTMELER, maliyet, rutbe, temizleKayit, pasifGelir, patlamaYaricapi, onizlemeNoktasi, ruzgarDirenci,
  yeniArazi, arazi, baslangic, adim, carpisma, hedefKonumu, patlamaKurbanlari, puan, seriCarpani, zorluk,
  ruzgarMax, yeniHedefler, yorunge,
} from './game-logic.js';

const HATALAR = [
  'Layout Shift', 'Dev görsel', 'Eksik alt metni', 'Render engelleyici JS', 'Kırık link',
  'Düşük kontrast', 'Yavaş sunucu', '404', 'Gereksiz script', 'Büyük font dosyası',
  'Sıkıştırılmamış CSS', 'Eksik meta açıklama',
];
const KAYIT_ANAHTARI = 'havanTopuKaydi';
const FIZIK_DT = 1 / 120;
const MAX_SURUKLEME = 140; // bu kadar piksel geri çekmek = %100 güç
const { W, H } = DUNYA;
// Projede yalnızca bu palet kullanılır (bkz. styles.css).
const PAL = {
  bejAcik: '#e5d6c5', bej: '#c4a381', bejKoyu: '#a38260',
  kiremitAcik: '#c88d85', kiremit: '#b2675e', kiremitKoyu: '#8c4b43',
  kahveAcik: '#896756', kahve: '#644536', kahveKoyu: '#432c21',
};

const waitingEl = document.getElementById('waiting');
const gameResultEl = document.getElementById('game-result');

let oyun = null;

const fmt = (n) => Math.floor(n).toLocaleString('tr-TR');
const rnd = (a, b) => a + Math.random() * (b - a);
const kisitla = (x, a, b) => Math.max(a, Math.min(b, x));

function kayitOku() {
  try {
    return temizleKayit(JSON.parse(localStorage.getItem(KAYIT_ANAHTARI)));
  } catch {
    return temizleKayit(null); // bozuk veri veya gizli mod
  }
}

function kayitYaz() {
  try {
    const { ms, toplam, seviyeler } = oyun;
    localStorage.setItem(KAYIT_ANAHTARI, JSON.stringify({ ms, toplam, seviyeler }));
  } catch {
    // saklanamazsa oyun yine de çalışır
  }
}

function yeniTur() {
  const z = zorluk(oyun.isabet);
  oyun.arazi = yeniArazi();
  oyun.hedefler = yeniHedefler(z).map((h) => ({ ...h, ad: HATALAR[Math.floor(Math.random() * HATALAR.length)] }));
  yeniRuzgar();
}

function yeniRuzgar() {
  const maks = ruzgarMax(zorluk(oyun.isabet));
  oyun.ruzgar = Math.round(rnd(-maks, maks));
}

const namluDibi = () => ({ x: DUNYA.mortarX, y: arazi(DUNYA.mortarX, oyun.arazi) - 10 });

export function startWaiting() {
  gameResultEl.hidden = true;
  oyun = {
    ...kayitOku(),
    t: 0, aci: 45, guc: 40, ruzgar: 0, arazi: null, hedefler: [],
    top: null, iz: [], patlamalar: [], yuzen: [], surukluyor: false, isaretci: null,
    seri: 0, atis: 0, isabet: 0, kazanilan: 0, bekleme: 0,
    baslangic: Date.now(), timers: [], raf: 0, son: performance.now(),
  };
  yeniTur();

  const msEl = el('strong', { id: 'oyun-ms', text: '0' });
  const rutbeEl = el('span', { class: 'oyun-rutbe' });
  const seriEl = el('span', { class: 'oyun-kombo' });
  const sureEl = el('span', { id: 'bekleme-sure', text: '0' });
  const nisanEl = el('span', { class: 'nisan-bilgi', 'aria-live': 'off' });
  const adimlar = ['Topuzu tut', 'Geriye çek', 'Bırak: ateş'].map((m, i) => el('li', { class: 'adim' }, [el('b', { text: String(i + 1) }), el('span', { text: m })]));
  const adimlarEl = el('ol', { class: 'adimlar', 'aria-hidden': 'true' }, adimlar);

  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = el('canvas', {
    id: 'oyun-canvas', class: 'oyun-canvas', width: String(W * dpr), height: String(H * dpr), tabindex: '0',
    role: 'application',
    'aria-label': 'Havan topu oyunu. Yukarı aşağı oklar açıyı, sağ sol oklar gücü değiştirir, boşluk ateş eder.',
  });
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);

  const satirlar = YUKSELTMELER.map((y) => {
    const btn = el('button', { type: 'button', class: 'yukseltme' });
    btn.addEventListener('click', () => {
      const seviye = oyun.seviyeler[y.id];
      const bedel = maliyet(y, seviye);
      if (seviye >= y.max || oyun.ms < bedel) return;
      oyun.ms -= bedel;
      oyun.seviyeler[y.id] += 1;
      kayitYaz();
      guncelle();
    });
    return { y, btn };
  });

  function guncelle() {
    msEl.textContent = fmt(oyun.ms);
    rutbeEl.textContent = `Rütbe: ${rutbe(oyun.toplam)}`;
    const carpan = seriCarpani(oyun.seri);
    seriEl.textContent = carpan > 1 ? `Seri x${carpan}` : '';
    for (const { y, btn } of satirlar) {
      const seviye = oyun.seviyeler[y.id];
      const dolu = seviye >= y.max;
      const bedel = maliyet(y, seviye);
      btn.disabled = dolu || oyun.ms < bedel;
      btn.replaceChildren(
        el('strong', { text: `${y.ad} · Sv ${seviye}` }),
        el('span', { text: dolu ? 'MAKS' : `${fmt(bedel)} ms` }),
        el('small', { text: y.aciklama }),
      );
    }
  }

  // --- Girdi: sapan gibi geri çek ve bırak ---
  function noktaAl(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  }

  function nisanAl(p) {
    const n = namluDibi();
    const vx = n.x - p.x; // geri çekme vektörü: atış yönünün tersi
    const vy = n.y - p.y;
    oyun.aci = kisitla((Math.atan2(-vy, vx) * 180) / Math.PI, 5, 85);
    oyun.guc = kisitla(Math.hypot(vx, vy) / (MAX_SURUKLEME / 100), 0, 100);
  }

  const atisHazir = () => !oyun.top && oyun.bekleme <= 0;

  function ateset() {
    if (!atisHazir() || oyun.guc < 8) return;
    const n = namluDibi();
    oyun.top = baslangic(n.x, n.y, oyun.aci, oyun.guc);
    oyun.iz = [];
    oyun.atis += 1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!atisHazir()) return;
    canvas.focus();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // yakalama başarısız olsa da sürükleme çalışmaya devam eder
    }
    oyun.surukluyor = true;
    oyun.isaretci = noktaAl(e);
    nisanAl(oyun.isaretci);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!oyun.surukluyor) return;
    oyun.isaretci = noktaAl(e);
    nisanAl(oyun.isaretci);
  });
  const birak = () => {
    if (!oyun.surukluyor) return;
    oyun.surukluyor = false;
    oyun.isaretci = null;
    ateset();
  };
  canvas.addEventListener('pointerup', birak);
  canvas.addEventListener('pointercancel', () => {
    oyun.surukluyor = false;
    oyun.isaretci = null;
  });
  canvas.addEventListener('keydown', (e) => {
    const adimBuyuklugu = e.shiftKey ? 5 : 1;
    const tuslar = {
      ArrowUp: () => { oyun.aci = kisitla(oyun.aci + adimBuyuklugu, 5, 85); },
      ArrowDown: () => { oyun.aci = kisitla(oyun.aci - adimBuyuklugu, 5, 85); },
      ArrowRight: () => { oyun.guc = kisitla(oyun.guc + adimBuyuklugu, 0, 100); },
      ArrowLeft: () => { oyun.guc = kisitla(oyun.guc - adimBuyuklugu, 0, 100); },
      ' ': ateset,
      Enter: ateset,
    };
    if (tuslar[e.key]) {
      e.preventDefault();
      tuslar[e.key]();
    }
  });

  // --- Oyun mantığı ---
  function patlat(c) {
    const yaricap = patlamaYaricapi(oyun.seviyeler.barut);
    oyun.patlamalar.push({ x: c.x, y: c.y, t0: oyun.t, r: yaricap, tip: c.tip });
    const kurbanlar = patlamaKurbanlari(c, oyun.hedefler, oyun.t, oyun.arazi, yaricap);
    let toplamKazanc = 0;
    for (const i of kurbanlar) {
      const k = hedefKonumu(oyun.hedefler[i], oyun.t, oyun.arazi);
      const kazanc = puan(Math.abs(k.x - DUNYA.mortarX), i === c.hedef, oyun.seri);
      toplamKazanc += kazanc;
      oyun.yuzen.push({ x: k.x, y: k.y - 24, t0: oyun.t, metin: `+${kazanc} ms${i === c.hedef ? ' (tam isabet)' : ''}` });
    }
    if (kurbanlar.length) {
      oyun.hedefler = oyun.hedefler.filter((_, i) => !kurbanlar.includes(i));
      oyun.ms += toplamKazanc;
      oyun.toplam += toplamKazanc;
      oyun.kazanilan += toplamKazanc;
      oyun.isabet += 1;
      oyun.seri += 1;
      kayitYaz();
    } else {
      oyun.seri = 0;
    }
    oyun.top = null;
    yeniRuzgar();
    if (!oyun.hedefler.length) oyun.bekleme = 0.8; // kısa bir nefes, sonra yeni arazi ve hedefler
    guncelle();
  }

  function fizikAdimi(dt) {
    if (!oyun.top) return;
    const direnc = ruzgarDirenci(oyun.seviyeler.aerodinamik);
    // Rüzgâr uçuş boyunca sabit kalır; yeniRuzgar yalnızca atıştan sonra çağrılır.
    oyun.top = adim(oyun.top, dt, oyun.ruzgar, direnc);
    oyun.iz.push({ x: oyun.top.x, y: oyun.top.y });
    if (oyun.iz.length > 60) oyun.iz.shift();
    const c = carpisma(oyun.top, oyun.arazi, oyun.hedefler, oyun.t);
    if (c) patlat(c);
  }

  // --- Çizim ---
  function ciz() {
    // Dar ekranda tuval küçüldüğü için yazı ve topuz boyutlarını büyüt (okunur ve parmakla tutulur kalsın).
    const ol = kisitla(W / canvas.getBoundingClientRect().width, 1, 2.4);
    ctx.fillStyle = PAL.kahveKoyu;
    ctx.fillRect(0, 0, W, H);

    // arazi
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 4) ctx.lineTo(x, arazi(x, oyun.arazi));
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = PAL.kahve;
    ctx.fill();
    ctx.strokeStyle = PAL.bej;
    ctx.lineWidth = 2;
    ctx.stroke();

    // hedefler: kanvas şekilleriyle çizilen böcek
    ctx.textAlign = 'center';
    for (const h of oyun.hedefler) {
      const k = hedefKonumu(h, oyun.t, oyun.arazi);
      ctx.beginPath();
      ctx.arc(k.x, k.y, DUNYA.hedefR, 0, Math.PI * 2);
      ctx.fillStyle = PAL.kiremitKoyu;
      ctx.fill();
      ctx.strokeStyle = PAL.kiremitAcik;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.lineWidth = 1.5;
      for (const d of [-1, 0, 1]) {
        for (const yon of [-1, 1]) {
          ctx.beginPath();
          ctx.moveTo(k.x + yon * 5, k.y + d * 4);
          ctx.lineTo(k.x + yon * 10, k.y + d * 7);
          ctx.stroke();
        }
      }
      ctx.beginPath();
      ctx.ellipse(k.x, k.y, 5, 7, 0, 0, Math.PI * 2);
      ctx.fillStyle = PAL.kiremit;
      ctx.fill();
      ctx.font = `600 ${11 * ol}px Outfit, system-ui`;
      ctx.fillStyle = PAL.bejAcik;
      ctx.fillText(h.ad, k.x, k.y - DUNYA.hedefR - 5);
    }

    // havan
    const n = namluDibi();
    const a = (oyun.aci * Math.PI) / 180;
    ctx.save();
    ctx.translate(n.x, n.y);
    ctx.rotate(-a);
    ctx.fillStyle = PAL.bej;
    ctx.fillRect(-4, -6, DUNYA.namluBoyu + 4, 12);
    ctx.restore();
    ctx.beginPath();
    ctx.arc(n.x, n.y + 6, 13, Math.PI, 0);
    ctx.fillStyle = PAL.bejKoyu;
    ctx.fill();

    // nişan: önizleme yörüngesi (uzaklaştıkça küçülen noktalar) ve lastik
    if (atisHazir()) {
      const b = baslangic(n.x, n.y, oyun.aci, oyun.guc);
      const nokta = yorunge(b, oyun.ruzgar, ruzgarDirenci(oyun.seviyeler.aerodinamik), onizlemeNoktasi(oyun.seviyeler.nisangah), oyun.arazi);
      ctx.fillStyle = PAL.bejAcik;
      nokta.forEach((p, i) => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6 * (1 - i / (nokta.length + 4)), 0, Math.PI * 2);
        ctx.fill();
      });
    }
    // Sapan topuzu: havanın arkasında, tam çekilecek yerde durur; lastik havana bağlıdır.
    if (atisHazir() || oyun.top) {
      const d = (oyun.guc / 100) * MAX_SURUKLEME;
      const ux = -Math.cos(a);
      const uy = Math.sin(a);
      const pr = 14 * ol;
      const ilk = oyun.atis === 0 && !oyun.surukluyor && atisHazir();
      const nabiz = ilk ? Math.sin(oyun.t * 5) * 3 * ol : 0;
      const kx = kisitla(n.x + ux * d, pr + 4, W - pr - 4);
      const ky = kisitla(n.y + uy * d, pr + 4, H - pr - 4);
      ctx.strokeStyle = oyun.surukluyor ? PAL.bejAcik : PAL.bej;
      ctx.lineWidth = (oyun.surukluyor ? 4 : 2.5) * Math.min(ol, 1.6);
      ctx.beginPath();
      ctx.moveTo(n.x, n.y);
      ctx.lineTo(kx, ky);
      ctx.stroke();
      if (ilk) {
        // Eller kaybolmadan önce: topuzdan geriye doğru akan ok, ne yapılacağını gösterir.
        const f = (oyun.t * 0.7) % 1;
        const gx = kx + ux * 60 * f;
        const gy = ky + uy * 60 * f;
        ctx.setLineDash([6 * ol, 6 * ol]);
        ctx.strokeStyle = PAL.bejAcik;
        ctx.lineWidth = 2 * Math.min(ol, 1.6);
        ctx.beginPath();
        ctx.moveTo(kx, ky);
        ctx.lineTo(gx, gy);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(gx, gy, pr * 0.55, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.arc(kx, ky, pr + nabiz + (oyun.surukluyor ? 3 * ol : 0), 0, Math.PI * 2);
      ctx.fillStyle = PAL.bej;
      ctx.fill();
      ctx.strokeStyle = PAL.bejAcik;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(kx, ky, pr * 0.35, 0, Math.PI * 2);
      ctx.fillStyle = PAL.kahveKoyu;
      ctx.fill();
      if (atisHazir() && (ilk || oyun.surukluyor)) {
        ctx.textAlign = kx < 120 * ol ? 'left' : 'center';
        ctx.font = `700 ${13 * ol}px Outfit, system-ui`;
        ctx.fillStyle = PAL.bejAcik;
        const yazi = oyun.surukluyor ? 'BIRAK = ATEŞ' : 'TUT VE GERİYE ÇEK';
        const tw = ctx.measureText(yazi).width;
        const ph = 22 * ol;
        const px = ctx.textAlign === 'left' ? 4 : kisitla(kx - tw / 2 - 8 * ol, 2, W - tw - 18 * ol);
        const alta = ky + pr + 8 * ol;
        const py = alta + ph <= H - 2 ? alta : ky - pr - 8 * ol - ph;
        ctx.fillStyle = PAL.kahveKoyu;
        ctx.fillRect(px, py, tw + 16 * ol, ph);
        ctx.strokeStyle = PAL.bej;
        ctx.lineWidth = 1.5;
        ctx.strokeRect(px, py, tw + 16 * ol, ph);
        ctx.fillStyle = PAL.bejAcik;
        ctx.textAlign = 'left';
        ctx.fillText(yazi, px + 8 * ol, py + ph - 7 * ol);
        ctx.textAlign = 'center';
      }
      oyun.adim = oyun.surukluyor ? (oyun.guc < 30 ? 1 : 2) : ilk ? 0 : -1;
    }

    // mermi izi (eski noktalar küçülür) ve mermi
    ctx.fillStyle = PAL.bejKoyu;
    oyun.iz.forEach((p, i) => {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2 * (i / oyun.iz.length), 0, Math.PI * 2);
      ctx.fill();
    });
    if (oyun.top) {
      ctx.beginPath();
      ctx.arc(oyun.top.x, oyun.top.y, DUNYA.topR, 0, Math.PI * 2);
      ctx.fillStyle = PAL.bejAcik;
      ctx.fill();
    }

    // patlamalar: büyüyen dolu daire, sonra incelen halka
    oyun.patlamalar = oyun.patlamalar.filter((p) => oyun.t - p.t0 < 0.45);
    for (const p of oyun.patlamalar) {
      const f = (oyun.t - p.t0) / 0.45;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * Math.min(1, f * 1.6), 0, Math.PI * 2);
      if (f < 0.5) {
        ctx.fillStyle = PAL.kiremitAcik;
        ctx.fill();
      }
      ctx.strokeStyle = PAL.bejAcik;
      ctx.lineWidth = Math.max(0.5, 3 * (1 - f));
      ctx.stroke();
    }
    oyun.yuzen = oyun.yuzen.filter((y) => oyun.t - y.t0 < 1.1);
    ctx.font = `700 ${15 * ol}px Outfit, system-ui`;
    ctx.fillStyle = PAL.bejAcik;
    for (const y of oyun.yuzen) {
      const f = (oyun.t - y.t0) / 1.1;
      ctx.fillText(y.metin, y.x, y.y - f * 30);
    }

    // rüzgâr göstergesi
    const yon = oyun.ruzgar === 0 ? '·' : oyun.ruzgar > 0 ? '→' : '←';
    ctx.textAlign = 'center';
    ctx.font = `700 ${14 * ol}px Outfit, system-ui`;
    ctx.fillStyle = PAL.bej;
    ctx.fillText(`Rüzgâr ${yon} ${Math.abs(oyun.ruzgar)}`, W / 2, 8 + 14 * ol);
  }

  function dongu(simdi) {
    const dt = Math.min(0.05, (simdi - oyun.son) / 1000);
    oyun.son = simdi;
    oyun.t += dt;
    if (oyun.bekleme > 0) {
      oyun.bekleme -= dt;
      if (oyun.bekleme <= 0) yeniTur();
    }
    for (let kalan = dt; kalan > 1e-9 && oyun.top; kalan -= FIZIK_DT) fizikAdimi(Math.min(FIZIK_DT, kalan));
    nisanEl.textContent = `Açı ${Math.round(oyun.aci)}° · Güç ${Math.round(oyun.guc)}`;
    ciz();
    adimlar.forEach((li, i) => li.classList.toggle('aktif', i === oyun.adim));
    adimlarEl.hidden = oyun.atis > 1 && !oyun.surukluyor;
    canvas.classList.toggle('tutuyor', oyun.surukluyor);
    oyun.raf = requestAnimationFrame(dongu);
  }

  waitingEl.replaceChildren(
    el('h2', { text: 'Havan Topu — Hata Avcısı' }),
    el('p', {
      class: 'bekleme-alt',
      text: 'Havanın arkasındaki yuvarlak topuzu tut, geriye çek, bırak: top ateşlenir. Rüzgârı ve tepeyi hesaba kat, hataları vur, ms kazan. Klavye: ↑↓ açı, ←→ güç, Boşluk ateş. İlerlemen kaydedilir.',
    }),
    el('div', { class: 'oyun-hud' }, [
      el('span', {}, [el('span', { text: 'Kazanç: ' }), msEl, el('span', { text: ' ms' })]),
      rutbeEl,
      seriEl,
      nisanEl,
      el('span', { class: 'bekleme-sure' }, [el('span', { text: 'Süre: ' }), sureEl, el('span', { text: ' sn' })]),
    ]),
    adimlarEl,
    canvas,
    el('div', { class: 'yukseltmeler' }, satirlar.map((s) => s.btn)),
  );
  waitingEl.hidden = false;
  guncelle();
  oyun.raf = requestAnimationFrame(dongu);

  oyun.timers.push(
    setInterval(() => {
      sureEl.textContent = String(Math.floor((Date.now() - oyun.baslangic) / 1000));
      const pasif = pasifGelir(oyun.seviyeler.otomatik);
      if (pasif) {
        oyun.ms += pasif;
        oyun.toplam += pasif;
        oyun.kazanilan += pasif;
        guncelle();
      }
    }, 1000),
    setInterval(kayitYaz, 3000),
  );
}

// Oyunu durdurur ve kaydeder; bu bekleyişin özetini döndürür.
export function stopWaiting() {
  if (!oyun) return null;
  cancelAnimationFrame(oyun.raf);
  oyun.timers.forEach(clearInterval);
  kayitYaz();
  waitingEl.hidden = true;
  const ozet = { atis: oyun.atis, isabet: oyun.isabet, kazanilan: oyun.kazanilan, toplam: oyun.toplam };
  oyun = null;
  return ozet;
}

export function showGameResult(ozet) {
  if (!ozet || (!ozet.atis && !ozet.kazanilan)) {
    gameResultEl.hidden = true;
    return;
  }
  const isabetOrani = ozet.atis ? Math.round((ozet.isabet / ozet.atis) * 100) : 0;
  gameResultEl.replaceChildren(
    el('h2', { text: `${ozet.atis} atışta ${ozet.isabet} isabet (%${isabetOrani}), ${fmt(ozet.kazanilan)} ms kazandın` }),
    el('p', { class: 'rekor', text: `Toplam: ${fmt(ozet.toplam)} ms · Rütbe: ${rutbe(ozet.toplam)}` }),
    el('p', { class: 'bekleme-alt', text: 'İlerlemen kaydedildi; bir sonraki analizde kaldığın yerden devam edersin.' }),
  );
  gameResultEl.hidden = false;
}
