// Normalleştirilmiş denetim sorunlarından Claude / ChatGPT için kopyala-yapıştır prompt'ları üretir.
// Prompt'lar tek başına yeterli olacak kadar bağlam taşır: cihaz, teknoloji, skorlar, ölçümler ve öğeler.

import { ANALYSES } from './analyses.js';

const DEVICES = {
  mobile: 'Mobil (Lighthouse emülasyonu: Moto G Power sınıfı cihaz, yavaşlatılmış 4G, 4x CPU yavaşlatma)',
  desktop: 'Masaüstü (Lighthouse emülasyonu: geniş ekran, kablolu bağlantı, CPU yavaşlatma yok)',
};

const ROLE = 'Kıdemli bir web performans, erişilebilirlik, güvenlik ve SEO mühendisi olarak çalış. Cevabın doğrudan uygulanabilir, teknik ve somut olsun.';
const PSI_BASED = new Set(ANALYSES.filter((a) => a.usesDevice).map((a) => a.id));
const analysisLabel = (id) => ANALYSES.find((a) => a.id === id)?.label ?? id;

const ASSUMPTIONS =
  'Projenin kaynak kodunu görmüyorsun: kullanıcıdan dosya isteme. Algılanan teknolojinin standart dosya yapısını ve API\'lerini varsayarak doğrudan kod ver; her varsayımını "Varsayım:" etiketiyle açıkça yaz. Teknoloji algılanmadıysa URL\'lerden ve öğelerden çıkarım yap, yoksa framework\'ten bağımsız HTML/CSS/JS ver.';

// Her kategori farklı bir etki türü, farklı riskler ve farklı doğrulama araçları gerektirir.
const PROFILES = {
  performance: {
    impact: '**Metrik etkisi** — Hangi Lighthouse / Core Web Vitals metriklerini (LCP, FCP, TBT, CLS, INP, TTI) nasıl ve yaklaşık ne kadar etkilediğini belirt.',
    code: 'Algılanan teknolojinin yerleşik performans çözümlerini kullan (ör. Next.js: `next/script`, `next/font`, `next/image`, `next/dynamic`).',
    risks: 'analitik veri kaybı, FOUC, layout kayması, önbellek davranışı',
    verify: 'Chrome DevTools Performance, Network ve Coverage panelleri ile Lighthouse; düzeltme sonrası beklenen ölçüm değerini yaz.',
  },
  accessibility: {
    impact: '**Kullanıcı ve standart etkisi** — Hangi kullanıcıları (ekran okuyucu, klavye, sesli kontrol, az gören) nasıl etkilediğini ve ilgili WCAG 2.2 başarı kriterini (numarası ve seviyesiyle, ör. 1.4.3 AA) belirt.',
    code: 'Önce semantik HTML, gerekirse ARIA kullan. Öğelerdeki sınıflar Tailwind ise düzeltmeyi Tailwind sınıflarıyla ver. Renk önerirken yeni renk çiftinin kontrast oranını hesaplayıp yaz.',
    risks: 'görsel tasarımın değişmesi, ekran okuyucuda çift okuma, odak sırasının bozulması',
    verify: 'Chrome DevTools Elements > Accessibility ve renk seçicideki kontrast göstergesi, Lighthouse Accessibility ve bir ekran okuyucu (VoiceOver/NVDA) ile kontrol; beklenen sonucu (ör. kontrast ≥ 4.5:1) yaz.',
  },
  'best-practices': {
    impact: '**Güvenlik ve uyumluluk etkisi** — Güvenlik, tarayıcı uyumluluğu, kullanıcı güveni ve hata görünürlüğü açısından etkisini belirt.',
    code: 'Standart web API\'leri ve algılanan teknolojinin önerdiği yapılandırmayı kullan.',
    risks: 'tarayıcı uyumluluğu, üçüncü taraf entegrasyonların bozulması, CSP/izin hataları',
    verify: 'Chrome DevTools Console, Issues ve Security panelleri ile Lighthouse Best Practices; beklenen sonucu yaz.',
  },
  crux: {
    impact: '**Gerçek kullanıcı etkisi** — Bu metriğin gerçek ziyaretçilerde (75. yüzdelik) ne anlama geldiğini, Core Web Vitals değerlendirmesini ve Google sıralamasını nasıl etkilediğini belirt. Laboratuvar (Lighthouse) ile saha verisi arasındaki olası farkı açıkla.',
    code: 'Algılanan teknolojinin yerleşik performans çözümlerini kullan (ör. Next.js: `next/script`, `next/font`, `next/image`, `next/dynamic`).',
    risks: 'analitik veri kaybı, FOUC, layout kayması, önbellek davranışı',
    verify: 'Değişikliği önce Lighthouse ve DevTools Performance (CPU/ağ yavaşlatmalı) ile doğrula; saha verisinin (CrUX) güncellenmesinin 28 günlük kayan pencere nedeniyle haftalar süreceğini belirt. Gerçek kullanıcı ölçümü için `web-vitals` kütüphanesiyle RUM önerisini ekle.',
  },
  security: {
    impact: '**Güvenlik etkisi** — Eksik başlığın hangi saldırı türlerine (XSS, clickjacking, MIME sniffing, SSL stripping, bilgi sızıntısı) kapı açtığını ve gerçekçi bir saldırı senaryosunu açıkla.',
    code: 'Başlıkları algılanan barındırma/framework katmanında tanımla (ör. Next.js `next.config.js` içindeki `headers()`, Vercel `vercel.json`, Nginx `add_header`, Cloudflare kuralları). CSP için önce `Content-Security-Policy-Report-Only` ile başlayan aşamalı bir plan ver ve nonce/hash yaklaşımını göster.',
    risks: 'üçüncü taraf script\'lerin (analitik, etiket yöneticisi, gömülü içerik) CSP yüzünden çalışmaması, iframe gömmelerin bozulması, önbellek/CDN başlık çakışmaları',
    verify: 'DevTools Network panelinde yanıt başlıklarını ve Console\'daki CSP ihlallerini kontrol et, ardından Mozilla Observatory\'de yeniden tarat; beklenen not ve puanı yaz.',
  },
  ssl: {
    impact: '**Güvenlik ve uyumluluk etkisi** — Bu yapılandırmanın hangi saldırılara (araya girme, protokol düşürme, oturum çalma) açık bıraktığını ve tarayıcı uyarılarına yol açıp açmadığını belirt.',
    code: 'Ayarı TLS\'in sonlandığı katmanda ver (CDN/barındırma paneli, Nginx/Apache, yük dengeleyici). Birden çok sunucu IP\'si varsa hepsine aynı yapılandırmanın nasıl uygulanacağını açıkla.',
    risks: 'eski istemcilerin bağlanamaması, HSTS preload\'un geri alınmasının zorluğu, sertifika yenilemenin bozulması',
    verify: '`openssl s_client`/`curl -I` komutları ve SSL Labs yeniden taraması (önbelleği temizleyerek); her sunucu IP\'si için beklenen notu yaz.',
  },
  html: {
    impact: '**Uyumluluk etkisi** — Bu hatanın tarayıcı farklılıklarına, erişilebilirliğe, SEO\'ya veya hidrasyon (SSR) hatalarına yol açıp açmadığını belirt; zararsız bir uyarıysa bunu açıkça söyle.',
    code: 'Düzeltmeyi işaretlemeyi üreten bileşen veya şablon düzeyinde ver; framework\'ün ürettiği ve geliştiricinin kontrolünde olmayan çıktıysa bunu belirt.',
    risks: 'hidrasyon uyuşmazlığı, stil kayması, üçüncü taraf bileşenlerin etkilenmesi',
    verify: 'W3C Nu HTML Checker\'da yeniden doğrula ve DevTools Console\'da hidrasyon uyarısı olmadığını kontrol et.',
  },
  links: {
    impact: '**Kullanıcı ve SEO etkisi** — Kırık bağlantıların kullanıcı akışını, güveni ve arama motoru taramasını (tarama bütçesi, bağlantı değeri) nasıl etkilediğini belirt.',
    code: 'Bağlantıları kaynağında düzelt (bileşen, CMS içeriği, menü yapılandırması); taşınmış sayfalar için kalıcı (301/308) yönlendirme kuralını algılanan teknolojide göster (ör. Next.js `redirects()`).',
    risks: 'dış sitelerden gelen eski bağlantıların kırılması, yönlendirme döngüleri',
    verify: 'Bağlantıları tarayıcıda ve `curl -I` ile kontrol et, kırık bağlantı taramasını yeniden çalıştır; Google Search Console\'daki 404 raporunu takip et.',
  },
  seo: {
    impact: '**Arama motoru etkisi** — Taranabilirlik, dizine eklenme, arama sonucu görünümü ve tıklanma oranına etkisini belirt.',
    code: 'Algılanan teknolojinin meta veri çözümünü kullan (ör. Next.js Metadata API, `robots.ts`, `sitemap.ts`).',
    risks: 'yanlışlıkla noindex, kanonik adres hataları, yinelenen içerik',
    verify: 'Lighthouse SEO, Google Search Console URL Denetimi ve Zengin Sonuçlar Testi; beklenen sonucu yaz.',
  },
};

function outputSections(categoryId) {
  const p = PROFILES[categoryId] ?? PROFILES.performance;
  return [
    '**Kök neden** — Sorunun bu sitede neden oluştuğunu, yukarıdaki etkilenen öğelere ve ölçümlere atıf yaparak açıkla. Genel tanım yapma.',
    p.impact,
    '**Çözüm adımları** — Etkisi en yüksek olandan başlayarak numaralı adımlar. Her adımda, algılanan teknolojinin olağan dosya yapısına göre hangi dosyada neyin değişeceğini yaz.',
    `**Kod** — Her adım için "Önce" ve "Sonra" kod blokları. ${p.code}`,
    `**Riskler ve yan etkiler** — Değişikliğin bozabileceği şeyler (${p.risks}) ve bunları nasıl önleyeceğin.`,
    `**Doğrulama** — ${p.verify}`,
  ];
}

const RULES = [
  'Yeni bağımlılık ekleme; gerekiyorsa nedenini ve alternatifini yaz.',
  'Mevcut işlevselliği ve görsel tasarımı koru.',
  'Yanıtı yukarıdaki bölüm başlıklarıyla Markdown olarak ver.',
];

const numbered = (list) => list.map((x, i) => `${i + 1}. ${x}`);

function contextBlock(report, extra = []) {
  const stacks = report.stacks?.length ? report.stacks.join(', ') : 'Algılanmadı';
  const scores = report.categories.map((c) => `${c.label} ${c.score ?? '?'}/100`).join(' · ');
  const lines = [
    '## Bağlam',
    `- Site: ${report.finalUrl}`,
    ...(report.categories.some((c) => PSI_BASED.has(c.id)) ? [`- Test cihazı: ${DEVICES[report.strategy] ?? DEVICES.mobile}`] : []),
    `- Algılanan teknoloji: ${stacks}`,
    `- Skorlar: ${scores}`,
    ...(report.mode === 'custom'
      ? [`- Kapsam: Özel mod; yalnızca "${analysisLabel(report.analysis)}" analiz edildi. Ölçülmeyen alanlar (ör. hız metrikleri) hakkında rapordaki verinin ötesinde iddiada bulunma.`]
      : []),
    ...extra,
  ];
  if (report.warnings?.length) {
    lines.push('- Lighthouse çalıştırma uyarıları (sonuçlar eksik olabilir):', ...report.warnings.map((w) => `  - ${w}`));
  }
  return lines.join('\n');
}

function issueBlock(issue, heading) {
  const lines = [`${heading} ${issue.title}`, `- Denetim kimliği: \`${issue.id}\``];
  if (issue.scoreMode === 'binary') lines.push('- Denetim sonucu: Başarısız (geçti/kaldı denetimi)');
  else if (typeof issue.score === 'number') lines.push(`- Denetim skoru: ${Math.round(issue.score * 100)}/100`);
  if (issue.displayValue) lines.push(`- Ölçüm: ${issue.displayValue}`);
  if (issue.savings?.length) lines.push(`- Tahmini metrik kazancı: ${issue.savings.join(', ')}`);
  if (issue.weight) lines.push(`- Kategori skorundaki ağırlığı: ${issue.weight}`);
  if (issue.description) lines.push(`- Lighthouse açıklaması: ${issue.description}`);
  if (issue.items.length) {
    lines.push('- Etkilenen öğeler (Lighthouse\'un raporladıkları):');
    issue.items.forEach((item, i) => lines.push(`  ${i + 1}. ${item}`));
  }
  if (issue.docsUrl) lines.push(`- Resmi dokümantasyon: ${issue.docsUrl}`);
  return lines.join('\n');
}

const tail = (sections) => [
  '## Senden istediklerim',
  ...numbered(sections),
  '',
  '## Kurallar',
  ...RULES.map((r) => `- ${r}`),
  `- ${ASSUMPTIONS}`,
].join('\n');

export function buildIssuePrompt(issue, { report, categoryId, categoryLabel, source }) {
  return [
    ROLE,
    '',
    contextBlock(report, [`- Sorunun kategorisi: ${categoryLabel}${source ? ` (kaynak: ${source})` : ''}`]),
    '',
    '## Sorun',
    issueBlock(issue, '###'),
    '',
    tail(outputSections(categoryId)),
    '- Yalnızca bu soruna odaklan.',
  ].join('\n');
}

export function buildCategoryPrompt(category, { report }) {
  return [
    ROLE,
    '',
    contextBlock(report, [
      `- Odak kategori: ${category.label} (skor: ${category.score ?? '?'}/100, ${category.issues.length} sorun${category.source ? `, kaynak: ${category.source}` : ''})`,
      ...(category.note ? [`- Analiz notu: ${category.note}`] : []),
    ]),
    '',
    '## Sorunlar (önem sırasına göre)',
    category.issues.map((issue, i) => issueBlock(issue, `### ${i + 1}.`)).join('\n\n'),
    '',
    tail([
      '**Öncelik tablosu** — Tüm sorunlar için tek tablo: sorun, etki (yüksek/orta/düşük), çaba (yüksek/orta/düşük), beklenen kazanç. Etki/çaba oranına göre sırala.',
      ['**Sorun bazında çözüm** — Her sorun için ayrı bir başlık altında şu alt bölümleri ver:', ...outputSections(category.id).map((s) => `   - ${s}`)].join('\n'),
      '**Ortak kök nedenler** — Birden fazla sorunu aynı anda çözen değişiklikleri (ör. ortak bir bileşeni veya tasarım token\'ını düzeltmek) ayrıca belirt ve tekrar etme.',
    ]),
  ].join('\n');
}

// Lighthouse çalıştırma uyarıları sitenin kendisiyle ilgilidir; bilinenleri açıklayıp düzeltme prompt'u üretir.
const WARNING_GUIDES = [
  {
    match: /zaman sınırı|did not finish loading|too slowly|timeout/i,
    hint: 'Lighthouse sayfa yüklendikten sonra ağın ve işlemcinin bir süre boşta kalmasını bekler. Sitede sürekli istek atan analitik/etiket script\'leri (Google Tag Manager, gtag), sürekli çalışan animasyonlar, uzun yoklama (long polling), WebSocket veya geç yüklenen widget\'lar varsa bu sessizlik oluşmaz ve test süre sınırına takılır. Bu, analiz aracının değil sitenin davranışıdır; ölçümler eksik veya iyimser olabilir. Üçüncü taraf script\'leri etkileşim sonrasına ertelemek genellikle uyarıyı ortadan kaldırır. Tekrar analiz etmek de farklı sonuç verebilir.',
    task: 'Bu uyarının bu sitede hangi kaynaklardan kaynaklanabileceğini aşağıdaki kaynaklara bakarak analiz et ve sayfanın yüklemeden sonra ağ ve ana iş parçacığı açısından sessizleşmesini sağlayacak değişiklikleri ver.',
    taskNoData:
      'Bu raporda kaynak listesi yok (performans ölçülmedi). Olası nedenleri (etiket yöneticileri ve analitik, sohbet/reklam widget\'ları, sürekli animasyonlar, polling/WebSocket, geç yüklenen gömülü içerik) bir kontrol listesi olarak ver; her biri için DevTools Network ve Performance panellerinde nasıl tespit edileceğini ve nasıl düzeltileceğini anlat.',
  },
  {
    match: /yönlendir|redirect/i,
    hint: 'Girilen adres başka bir adrese yönlendirildi; Lighthouse son adresi ölçtü. Yönlendirme zinciri ilk yüklemeyi yavaşlatır.',
    task: 'Yönlendirme zincirini kaldırmak için sunucu/CDN ve framework yapılandırmasında yapılacak değişiklikleri ver.',
  },
];

function buildWarningPrompt(warning, guide, report) {
  const thirdParty = report.categories
    .flatMap((c) => c.issues)
    .flatMap((i) => i.items)
    .filter((item) => /^https?:\/\//.test(item))
    .slice(0, 8);
  return [
    ROLE,
    '',
    contextBlock(report),
    '',
    '## Uyarı',
    `Lighthouse şu çalıştırma uyarısını verdi: "${warning}"`,
    '',
    thirdParty.length || !guide.taskNoData ? guide.task : guide.taskNoData,
    ...(thirdParty.length ? ['', 'Raporda öne çıkan kaynaklar:', ...thirdParty.map((u) => `- ${u}`)] : []),
    '',
    tail(outputSections('performance')),
  ].join('\n');
}

export function describeWarnings(report) {
  return (report.warnings ?? []).map((text) => {
    const guide = WARNING_GUIDES.find((g) => g.match.test(text));
    return {
      text,
      hint: guide?.hint ?? null,
      prompt: guide ? buildWarningPrompt(text, guide, report) : null,
    };
  });
}

export function attachPrompts(report) {
  return {
    ...report,
    warningDetails: describeWarnings(report),
    categories: report.categories.map((cat) => ({
      ...cat,
      prompt: cat.issues.length ? buildCategoryPrompt(cat, { report }) : null,
      issues: cat.issues.map((issue) => ({
        ...issue,
        prompt: buildIssuePrompt(issue, { report, categoryId: cat.id, categoryLabel: cat.label, source: cat.source }),
      })),
    })),
  };
}
