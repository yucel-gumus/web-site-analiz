import { el } from './dom.js';
import { startWaiting, stopWaiting, showGameResult } from './bekleme.js';

const form = document.getElementById('audit-form');
const input = document.getElementById('url-input');
const btn = document.getElementById('submit-btn');
const statusEl = document.getElementById('status');
const results = document.getElementById('results');
const scoresEl = document.getElementById('scores');
const tabsEl = document.getElementById('tabs');
const panelEl = document.getElementById('panel');
const aiBox = document.getElementById('ai-box');
const warningsEl = document.getElementById('warnings');
const picker = document.getElementById('analysis-picker');
const analysisSelect = document.getElementById('analysis-select');
const analysisHint = document.getElementById('analysis-hint');
const deviceGroup = document.getElementById('device-group');

// Her analiz türünün bekleme mesajı ve formun altındaki kısa açıklaması.
const ANALYSIS_INFO = {
  performance: { wait: 'Lighthouse (Performance) çalışıyor… genelde 20–60 saniye sürer.', hint: 'Yükleme hızı, Core Web Vitals laboratuvar ölçümleri ve optimizasyon fırsatları.' },
  accessibility: { wait: 'Lighthouse (Accessibility) çalışıyor…', hint: 'Kontrast, etiketler, ARIA ve klavye erişimi gibi erişilebilirlik denetimleri.' },
  'best-practices': { wait: 'Lighthouse (Best Practices) çalışıyor…', hint: 'HTTPS, konsol hataları, güncel olmayan API\'ler ve güvenli kod uygulamaları.' },
  seo: { wait: 'Lighthouse (SEO) çalışıyor…', hint: 'Meta etiketleri, taranabilirlik ve arama motoru uyumluluğu.' },
  crux: { wait: 'Gerçek kullanıcı verisi alınıyor… PageSpeed üzerinden 30–60 saniye sürebilir.', hint: 'Son 28 günde gerçek Chrome kullanıcılarının yaşadığı LCP, INP, CLS, FCP ve TTFB. Az trafikli sitelerde veri olmayabilir.' },
  security: { wait: 'Mozilla Observatory güvenlik başlıklarını tarıyor…', hint: 'CSP, HSTS, X-Frame-Options gibi HTTP güvenlik başlıkları. Taramayı Mozilla yapar; Mobil/Masaüstü seçimi kullanılmaz.' },
  ssl: { wait: 'SSL Labs taraması çalışıyor… yeni taramalar 1–4 dakika sürebilir (son 24 saatte taranmışsa hemen gelir).', hint: 'TLS protokolleri, sertifika, HSTS ve bilinen açıklar; siteye yanıt veren her sunucu ayrı değerlendirilir. Sonuç herkese açık panoda yayınlanmaz.' },
  html: { wait: 'W3C doğrulayıcı HTML\'i denetliyor…', hint: 'HTML işaretlemesinin standarda uygunluğu (W3C Nu HTML Checker).' },
  links: { wait: 'Sayfadaki bağlantılar tek tek deneniyor… bağlantı sayısına göre 10–60 saniye sürer.', hint: 'Sayfadaki ilk 60 bağlantının çalışıp çalışmadığı. Yalnızca sunucudan gelen HTML taranır.' },
};

function syncModeControls() {
  const custom = new FormData(form).get('mode') === 'custom';
  picker.hidden = !custom;
  analysisHint.hidden = !custom;
  const option = analysisSelect.selectedOptions[0];
  analysisHint.textContent = custom ? ANALYSIS_INFO[analysisSelect.value]?.hint ?? '' : '';
  // Observatory, SSL Labs, W3C ve bağlantı taraması cihaz emülasyonu kullanmaz.
  const noDevice = custom && option?.dataset.device === 'off';
  deviceGroup.classList.toggle('disabled', noDevice);
  for (const radio of deviceGroup.querySelectorAll('input')) radio.disabled = noDevice;
}
form.addEventListener('change', syncModeControls);
syncModeControls();

let report = null;
let ai = null;
let active = 0;

function scoreColor(score) {
  if (score == null) return 'var(--muted)';
  if (score >= 90) return 'var(--good)';
  if (score >= 50) return 'var(--warn)';
  return 'var(--bad)';
}

// Sunucu dışı bir katman (proxy, zaman aşımı sayfası) HTML döndürebilir; ayrıştırma hatasını kullanıcıya gösterme.
async function readJson(res) {
  try {
    return await res.json();
  } catch {
    const hint = res.status === 504 ? 'Analiz zaman aşımına uğradı.' : `Sunucudan beklenmeyen yanıt (${res.status}).`;
    throw new Error(`${hint} Biraz sonra tekrar dene.`);
  }
}

async function copyText(text, button) {
  if (button.classList.contains('done')) return; // geri sayım sürerken etiket "Kopyalandı" olarak kalmasın
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el('textarea', { text });
    document.body.append(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
  const original = button.textContent;
  button.textContent = 'Kopyalandı';
  button.classList.add('done');
  setTimeout(() => {
    button.textContent = original;
    button.classList.remove('done');
  }, 1800);
}

function promptActions(prompt, label) {
  const btn = el('button', { type: 'button', class: 'btn-ghost', text: label });
  btn.addEventListener('click', () => copyText(prompt, btn));
  return btn;
}

function renderScores() {
  const warnings = report.warningDetails ?? (report.warnings ?? []).map((text) => ({ text, hint: null, prompt: null }));
  warningsEl.hidden = !warnings.length;
  warningsEl.replaceChildren(
    ...(warnings.length ? [el('strong', { text: 'Lighthouse uyarısı: sonuçlar eksik veya yanıltıcı olabilir' })] : []),
    ...warnings.flatMap((w) => [
      el('p', { text: w.text }),
      ...(w.hint ? [el('p', { class: 'warning-hint', text: w.hint })] : []),
      ...(w.prompt
        ? [
            el('div', { class: 'actions' }, [promptActions(w.prompt, 'Bu uyarıyı çözmek için prompt\'u kopyala')]),
            el('details', {}, [el('summary', { text: 'Prompt\'u gör' }), el('pre', { text: w.prompt })]),
          ]
        : []),
    ]),
  );
  scoresEl.replaceChildren(
    ...(report.mode === 'custom'
      ? [el('p', { class: 'scope-note', text: `Özel mod: yalnızca ${report.categories.map((c) => c.label).join(', ')} analiz edildi. Tüm Lighthouse kategorileri için tam analiz çalıştır.` })]
      : []),
    ...report.categories.map((c) => {
      const ring = el('div', { class: 'ring', text: c.score ?? '–' });
      ring.style.setProperty('--c', scoreColor(c.score));
      const fill = el('span');
      fill.style.width = `${c.score ?? 0}%`;
      const bar = el('div', { class: 'meter', 'aria-hidden': 'true' }, [fill]);
      bar.style.setProperty('--c', scoreColor(c.score));
      return el('div', { class: 'card score' }, [ring, bar, el('div', { class: 'label', text: c.label })]);
    }),
  );
}

function renderTabs() {
  tabsEl.replaceChildren(
    ...report.categories.map((c, i) => {
      const tab = el('button', {
        type: 'button',
        class: 'tab',
        role: 'tab',
        'aria-selected': String(i === active),
        text: `${c.label} (${c.issues.length})`,
      });
      tab.addEventListener('click', () => {
        active = i;
        renderTabs();
        renderPanel();
      });
      return tab;
    }),
  );
}

function renderIssue(issue) {
  const card = el('article', { class: 'card issue' }, [el('h3', { text: issue.title })]);
  if (issue.displayValue) card.append(el('div', { class: 'meta', text: issue.displayValue }));
  const note = ai?.sorunlar.find((s) => s.id === issue.id);
  if (note) {
    card.append(
      el('div', { class: 'ai-note' }, [
        el('strong', { text: 'AI açıklaması' }),
        el('p', { text: note.aciklama }),
        el('strong', { text: 'Önerilen çözüm' }),
        el('p', { text: note.cozum }),
      ]),
    );
  } else if (issue.description) {
    card.append(el('p', { text: issue.description }));
  }
  if (issue.items.length) {
    card.append(el('ul', {}, issue.items.map((t) => el('li', { text: t }))));
  }
  const actions = el('div', { class: 'actions' }, [promptActions(issue.prompt, 'Prompt\'u kopyala')]);
  if (issue.docsUrl) {
    actions.append(el('a', { href: issue.docsUrl, target: '_blank', rel: 'noopener noreferrer', text: 'Dokümantasyon' }));
  }
  card.append(actions, el('details', {}, [el('summary', { text: 'Prompt\'u gör' }), el('pre', { text: issue.prompt })]));
  return card;
}

function renderPanel() {
  const cat = report.categories[active];
  // Lighthouse dışı analizlerin notu (kaynak, not/puan açıklaması, veri yokluğu) sorunlardan önce gösterilir.
  const note = cat.note
    ? [el('div', { class: 'card cat-note' }, [el('strong', { text: cat.source ? `${cat.source}: ` : '' }), el('span', { text: cat.note })])]
    : [];
  if (!cat.issues.length) {
    const empty = cat.score == null ? [] : [el('div', { class: 'card empty', text: `${cat.label} için sorun bulunmadı` })];
    panelEl.replaceChildren(...note, ...empty);
    return;
  }
  const head = el('div', { class: 'panel-head' }, [
    el('h2', { text: `${cat.issues.length} sorun bulundu` }),
    promptActions(cat.prompt, `Tüm ${cat.label} sorunları için tek prompt`),
  ]);
  panelEl.replaceChildren(...note, head, ...cat.issues.map(renderIssue));
}

const issueTitle = (id) =>
  report.categories.flatMap((c) => c.issues).find((i) => i.id === id)?.title ?? id;

function renderAi(state, data) {
  const title = el('h2', { text: 'AI Analizi' });
  if (state === 'loading') {
    aiBox.replaceChildren(title, el('p', { class: 'status loading', text: 'AI sonuçları analiz ediyor ve öncelik planı hazırlıyor…' }));
    return;
  }
  if (state === 'error') {
    aiBox.replaceChildren(title, el('p', { class: 'status error', text: data }));
    return;
  }
  const children = [title];
  if (data.ozet) children.push(el('p', { class: 'ai-summary', text: data.ozet }));
  if (data.oncelikler.length) {
    children.push(
      el('h3', { text: 'Öncelik planı (etki / çaba sırasıyla)' }),
      el('ol', { class: 'plan' }, data.oncelikler.map((p) =>
        el('li', {}, [
          el('strong', { text: issueTitle(p.id) }),
          el('span', { class: `badge etki-${p.etki}`, text: `Etki: ${p.etki}` }),
          el('span', { class: 'badge', text: `Çaba: ${p.caba}` }),
          el('p', { text: p.neden }),
          el('p', { class: 'fix', text: p.cozum }),
        ]),
      )),
    );
  }
  if (data.anaPrompt) {
    children.push(
      el('div', { class: 'actions' }, [promptActions(data.anaPrompt, 'Tüm site için ana prompt\'u kopyala')]),
      el('details', {}, [el('summary', { text: 'Ana prompt\'u gör' }), el('pre', { text: data.anaPrompt })]),
    );
  }
  aiBox.replaceChildren(...children);
}

async function loadAi(reportId) {
  renderAi('loading');
  try {
    const res = await fetch(`/api/ai?${new URLSearchParams({ reportId })}`);
    const data = await readJson(res);
    if (report?.reportId !== reportId) return; // kullanıcı yeni analiz başlattı
    if (!res.ok) throw new Error(data.error || 'AI analizi yapılamadı.');
    ai = data;
    renderAi('done', data);
    renderPanel();
  } catch (err) {
    if (report?.reportId === reportId) renderAi('error', err.message);
  }
}

function setStatus(message, kind = '') {
  statusEl.hidden = !message;
  statusEl.textContent = message;
  statusEl.className = `status ${kind}`;
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = input.value.trim();
  if (!url) {
    setStatus('Lütfen bir URL gir.', 'error');
    return;
  }
  const fields = new FormData(form);
  const strategy = fields.get('strategy') ?? 'mobile'; // cihaz kullanmayan analizlerde radyolar devre dışıdır
  const mode = fields.get('mode') === 'custom' ? 'custom' : 'full';
  const analysis = analysisSelect.value;
  btn.disabled = true;
  results.hidden = true;
  setStatus(
    mode === 'custom'
      ? ANALYSIS_INFO[analysis]?.wait ?? 'Analiz çalışıyor…'
      : 'Lighthouse ve gerçek kullanıcı verisi alınıyor… genelde 20–60 saniye, ağır sitelerde 2 dakikaya kadar sürebilir.',
    'loading',
  );
  startWaiting();
  try {
    const params = { url, strategy, mode, ...(mode === 'custom' ? { analysis } : {}) };
    const res = await fetch(`/api/audit?${new URLSearchParams(params)}`);
    const data = await readJson(res);
    if (!res.ok) throw new Error(data.error || 'Bilinmeyen hata');
    report = data;
    ai = null;
    active = 0;
    renderScores();
    renderTabs();
    renderPanel();
    setStatus('');
    results.hidden = false;
    showGameResult(stopWaiting());
    loadAi(data.reportId);
  } catch (err) {
    setStatus(err.message, 'error');
    results.hidden = !report; // önceki başarılı rapor varsa görünür kalsın
  } finally {
    stopWaiting(); // hata durumunda da bekleme ekranı kapanır (başarıda zaten kapalı)
    btn.disabled = false;
  }
});
