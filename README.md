# SiteAnaliz

Web sitenin adresini gir; performans, erişilebilirlik, güvenlik ve kod kalitesi sorunlarını bul. Bulunan her sorun için **Claude veya ChatGPT'ye yapıştırabileceğin, teknik ve bağlamı eksiksiz bir düzeltme prompt'u** al. Gemini bulguları Türkçe yorumlar ve etki/çaba sırasına göre öncelik planı çıkarır. Analiz sürerken oynanabilir bir mini oyun beklemeyi kısaltır.

Geliştiren: **[Yücel Gümüş](https://yucelgumus.dev/)**, Full Stack Developer & Yazılım Mühendisi · [yucelgumus.dev](https://yucelgumus.dev/)

## Analiz modları

### Tam analiz
Tek PageSpeed Insights çağrısıyla:
- Lighthouse'un dört kategorisi: **Performance, Accessibility, Best Practices, SEO**
- **Gerçek kullanıcı verisi (CrUX):** son 28 günde Chrome kullanıcılarının yaşadığı LCP, INP, CLS, FCP ve TTFB. Ek süre gerektirmez; az trafikli sitelerde Google bu veriyi yayınlamaz.

### Özel mod
Listeden **tek bir** analiz seçilir ve yalnızca o çalışır:

| Analiz | Kaynak | Not |
|---|---|---|
| Performance, Accessibility, Best Practices, SEO | Google Lighthouse (PageSpeed Insights) | Tek kategori |
| Gerçek Kullanıcı (CrUX) | Chrome UX Report API | Saniyeler içinde; API kapalıysa PageSpeed üzerinden |
| Güvenlik Başlıkları | Mozilla HTTP Observatory | CSP, HSTS, X-Frame-Options, Referrer-Policy… |
| SSL/TLS | Qualys SSL Labs | Her sunucu IP'si ayrı değerlendirilir; yeni tarama 1–4 dk, sonuç herkese açık panoda yayınlanmaz |
| HTML Doğrulama | W3C Nu HTML Checker | Tekrarlanan mesajlar gruplanır |
| Kırık Bağlantılar | SiteAnaliz bağlantı tarayıcısı | Sayfadaki ilk 60 bağlantı; yalnızca sunucudan gelen HTML |

Mobil/Masaüstü seçimi yalnızca Lighthouse ve CrUX analizlerini etkiler; diğerlerinde kilitlenir.

## Nasıl çalışır
1. URL ve mod seçilir. Sunucu ilgili servisleri çağırır ve sonuçları tek bir rapor biçimine normalleştirir.
2. Skorlar, sorunlar, etkilenen öğeler (seçici, dosya boyutu, kontrast oranı, satır numarası…) ve her analizin kaynak notu gösterilir.
3. Her sorun, her kategori ve tüm site için prompt üretilir. Prompt'lar kategoriye özeldir: erişilebilirlikte WCAG kriteri, güvenlikte saldırı senaryosu ve `Report-Only` geçiş planı, performansta metrik kazancı istenir. AI'dan dosya istemesi değil, algılanan teknolojiye (Next.js, Tailwind…) göre varsayım yapıp `Varsayım:` diye belirtmesi istenir.
4. Arka planda **Gemini** raporu analiz eder: özet, öncelik planı, sorun açıklamaları ve tüm site için ana prompt. AI başarısız olursa temel rapor ve prompt'lar yine çalışır.
5. Lighthouse çalıştırma uyarıları (ör. sayfa zaman sınırında yüklenmedi) açıklanır ve çözümü için ayrı prompt verilir.

## Çalıştırma
```bash
npm install
npm start    # http://localhost:3000 (PORT ile değiştirilebilir)
npm test     # node:test, harici test kütüphanesi yok
```

## Yapılandırma
Anahtarlar Firestore'da `aimunazara` projesi, `system_config/llm` belgesinde tutulur ve 5 dakika önbelleğe alınır: `pagespeed_api_key`, `gemini_api_key_primary`, `active_model`. Yerelde ortam değişkenleri (`PSI_API_KEY`, `GEMINI_API_KEY`, `GEMINI_MODEL`) verilirse onlar öncelik alır; örnek için `.env.example`. Yerelde Firestore okumak için `gcloud auth application-default login` gerekir.

- **CrUX API:** PageSpeed anahtarının projesinde *Chrome UX Report API* açık ve anahtarın API kısıtlamasına ekli olmalıdır; değilse CrUX verisi PageSpeed üzerinden (daha yavaş) alınır.
- **Proxy:** `X-Forwarded-For` yalnızca Cloud Run'da (`K_SERVICE`) veya `TRUST_PROXY` ayarlandığında dikkate alınır.

## Cloud Run'a dağıtım
```bash
gcloud run deploy site-analiz --source . --region europe-west3 --allow-unauthenticated \
  --timeout 300 --max-instances 1
```
- `--timeout 300`: yeni SSL Labs taraması 4 dakikaya kadar sürebilir.
- `--max-instances 1`: raporlar ve hız sınırları bellekte tutulur; AI isteğinin raporla aynı örneğe gitmesi için tek örnek kullanılır.
- Servis hesabının `aimunazara` Firestore'una okuma yetkisi olmalıdır.

## Güvenlik
- Yalnızca herkese açık `http/https` adresleri kabul edilir. `localhost` (sondaki noktalı biçimi dahil), `.local`/`.internal`, özel/ayrılmış IPv4 blokları (CGNAT dahil) ve IPv6 yazımları reddedilir.
- Kırık bağlantı taraması sunucunun kendisinin istek attığı tek yoldur: her bağlantıda ve her yönlendirmede DNS sonucu kontrol edilir, özel ağ IP'lerine bağlanılmaz (DNS rebinding koruması).
- IP başına dakikada 10 analiz ve 6 AI isteği sınırı vardır.
- AI, istemciden gelen metni değil, sunucuda 15 dakika saklanan raporu işler. Aynı rapor için eşzamanlı istekler tek Gemini çağrısını paylaşır.
- Denetlenen sitenin içeriği modele "güvenilmeyen veri" olarak verilir; verideki tüm `<` karakterleri kaçışlanır. Model çıktısı şemayla doğrulanır ve arayüzde yalnızca `textContent` ile basılır (`innerHTML` yok).
- Beklenmeyen iç hata ayrıntıları kullanıcıya gösterilmez.

## Yapı
```text
server/index.js          Express, /api/audit ve /api/ai, hız sınırı
server/analyses.js       Analiz türleri, tam analiz / özel mod yönlendirmesi
server/psi.js            PageSpeed Insights istemcisi ve Lighthouse normalizasyonu
server/checks/crux.js    Chrome UX Report (PageSpeed alanı veya CrUX API)
server/checks/observatory.js  Mozilla HTTP Observatory
server/checks/ssllabs.js Qualys SSL Labs (yoklamalı)
server/checks/w3c.js     W3C Nu HTML Checker
server/checks/links.js   Kırık bağlantı taraması
server/safe-fetch.js     SSRF korumalı HTTP istemcisi
server/url-guard.js      URL ve IP doğrulama
server/prompts.js        Kategoriye özel prompt şablonları ve uyarı açıklamaları
server/ai.js             Gemini analizi
server/report-store.js   Raporların kısa süreli bellek önbelleği
server/config.js         Firestore / ortam değişkeni yapılandırması
public/                  Arayüz (vanilla HTML/CSS/JS) ve bekleme oyunu
test/                    node:test testleri
```

## Tasarım kısıtları
Sıfır ön yüz bağımlılığı (vanilla JS). Arayüzde yalnızca 9 renklik bej-kiremit-kahve paleti kullanılır; saydamlık, gradyan ve gölge yoktur. Bu kurallar `test/palet.test.js` ile denetlenir.

---

**Yücel Gümüş** · Full Stack Developer & Yazılım Mühendisi · [yucelgumus.dev](https://yucelgumus.dev/)
