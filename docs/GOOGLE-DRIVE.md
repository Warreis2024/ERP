# Google Drive Entegrasyonu — NetERP

Son güncelleme: 20 Kasım 2026 · Durum: **Kişisel Drive (OAuth) çalışıyor ve test edildi.** Paylaşılan Drive (hizmet hesabı) kodu hazır; Workspace hesabıyla henüz denenmedi.

---

## 1. Ne yapıyor?

Firma, NetERP'yi bir Google Drive hesabına bağlar. Bağlandıktan sonra kayıtlara (proje, iş, servis, doküman…) eklenen dosyalar ERP sunucusuna değil, firmanın Drive'ına gider:

```
Drive'ım
└── NetERP/
    ├── PRJ-1042/        ← proje kodu (açıklamasında proje adı)
    │   ├── Invoice-MVG3NJAI-0001.pdf
    │   └── YÖNTEM TEKNOLOJİ VE ENDÜSTRİ.pptx
    ├── PRJ-1048/
    └── Genel/           ← projeye bağlı olmayan dosyalar
```

- Klasör adı **proje kodu** (`PRJ-1048`): proje adı değişse de klasör kaymaz. Proje adı klasör açıklamasına yazılır.
- Dosya boyutu sınırı pratikte yok: dosya 3,75 MB'lık parçalar halinde yüklenir (130 MB'lık sunum ile denendi).
- Kayıtta dosyanın Drive kimliği (`dosyaId`), klasörü (`klasor`) ve Drive bağlantısı (`url`) tutulur; önizleme ve "Aç" Drive üzerinden çalışır.

---

## 2. İki bağlantı yolu

| | **A) Kişisel / normal Drive (OAuth)** ✅ çalışıyor | **B) Paylaşılan Drive + ERP hizmet hesabı** |
|---|---|---|
| Müşterinin yaptığı | "Kişisel Drive'ı bağla" → Google hesabı seç → Drive kutusunu işaretle → izin ver | Paylaşılan Drive aç → ERP adresini "İçerik yöneticisi" ekle → "Kontrol et" |
| Gerekli hesap | Herhangi bir Google hesabı (@gmail.com dahil) | **Google Workspace** (kişisel Gmail'de Paylaşılan Drive yok) |
| Dosyaların sahibi | Bağlayan kişi (Drive'ım/NetERP) | Firma (kurumun ortak alanı; çalışan ayrılsa da kalır) |
| ERP'nin erişimi | Yalnız kendi açtığı NetERP klasörü (`drive.file`) | Yalnız üye yapıldığı Paylaşılan Drive |
| Kim görür | Workspace'te alan içi bağlantıyla; kişisel hesapta yalnız sahip | Paylaşılan Drive üyeleri |
| Satıcı ayarı | OAuth istemcisi + yayınlama (bir kez) | Hizmet hesabı + JSON anahtar (bir kez) |

> **Neden normal klasör paylaşımı (hizmet hesabıyla) olmuyor?** Google, hizmet hesaplarına depolama kotası vermiyor; hizmet hesabı kişisel Drive'daki bir klasöre dosya *sahibi olarak* yazamıyor (`storageQuotaExceeded: Service Accounts do not have storage quota`). Bu yüzden B yolu yalnız Paylaşılan Drive ile çalışır. Workspace'i olmayan müşteri için A yolu var.

**Müşteri hiçbir zaman** Google Cloud Console'a ya da Vercel'e girmez. Aşağıdaki "Satıcı kurulumu" yalnız bizim (IQ-Sense) bir kez yaptığımız iştir.

---

## 3. Satıcı kurulumu (bir kez, IQ-Sense)

### 3.0 Adım adım (ekran ekran) — kişisel Drive / OAuth

İlk kurulumdaki 8 adımlık liste, yaşanan hatalara göre düzeltilmiş hali. Sırayla yapılır; ayrıntılar 3.1–3.5'te.

1. **Google Cloud'da proje aç.** https://console.cloud.google.com → üstteki proje seçici → **Yeni proje** → ad: `NetERP` → Oluştur. Sonra üstten bu projeyi seçili hale getir.
2. **Drive API'yi aç.** Sol menü → *APIs & Services* → *Library* → arama: "Google Drive API" → aç → **Enable**.
   ~~Gmail API~~ açılmaz (e-posta ERP'nin kendi adresinden gidecek).
3. **İzin ekranını ayarla.** Sol menü → *Google Auth Platform* (bazı ekranlarda *OAuth consent screen*) → **Get started**. App name: `NetERP`, support e-posta: `admin@iq-sense.com.tr`.
   **Audience: External.** (Kurumsal Workspace hesabı olmayan geliştirici "Internal" seçemez; External doğru seçimdir.) Kaydet.
4. **İzinleri (scope) ekle.** Aynı bölümde *Data Access* → *Add or remove scopes*. Yalnız şunlar:
   `openid`, `.../auth/userinfo.email`, `.../auth/drive.file`.
   Listede bulunamazsa alttaki *Manually add scopes* kutusuna tam adres: `https://www.googleapis.com/auth/drive.file`. Kaydet.
   ⚠️ `gmail.send` **eklenmez** (hassas izin → "Access blocked"). Eklendiyse kaldırılır.
5. **Branding'i doldur.** *Branding* sayfası (yoksa "Publish app" düğmesi gri kalır):
   - Application home page: `https://yontem-erp.vercel.app/tanitim.html`
   - Privacy policy: `https://yontem-erp.vercel.app/gizlilik.html`
   - Terms of service: `https://yontem-erp.vercel.app/kosullar.html`
   - Authorized domains: `yontem-erp.vercel.app`
   - App logo: **boş bırak** (logo Google incelemesini başlatır). Save.
6. **OAuth istemcisi oluştur.** *Clients* (ya da *Credentials → Create credentials → OAuth client ID*). Type: **Web application**, Name: `NetERP Vercel`. *Authorized redirect URIs* altında *Add URI* → tam olarak:
   `https://yontem-erp.vercel.app/api/baglanti/google/donus` → **Create**. Açılan pencerede **Client ID** ve **Client secret** görünür; pencereyi kapatmadan sonraki adıma geç.
7. **İki değeri Vercel'e gir.** https://vercel.com → `yontem-erp` → *Settings* → *Environment Variables* → *Add New*:
   - `GOOGLE_CLIENT_ID` = Client ID · Environments: **Production**
   - `GOOGLE_CLIENT_SECRET` = Client secret · **Production**, *Sensitive* işaretli
   Save. Secret sohbete/e-postaya yapıştırılmaz. **Ardından yeniden yayın (redeploy)**: Vercel yeni değişkenleri ancak yeni yayında okur.
8. **Yayınla.** *Audience* → **Publish app** → onayla. (Yapılmazsa uygulama "Testing"te kalır: yalnız *Test users* listesindeki hesaplar bağlanabilir ve bağlantı 7 günde bir düşer.)

Sonrası ERP içindedir (bölüm 4): Ayarlar → Firma → Bulut depolar → **Kişisel Drive'ı bağla** → izin ekranında **Drive kutusunu işaretle** → Devam → Varsayılan depo otomatik Google Drive olur → bir projeye dosya yükleyip Drive'da `NetERP/PRJ-…` klasörüne bakılır.

### 3.1 Google Cloud projesi
1. https://console.cloud.google.com → yeni proje: **NetERP**.
2. *APIs & Services → Library* → **Google Drive API** → Enable.
   (Gmail API'ye gerek yok; e-posta ERP'nin kendi adresinden gidecek.)

### 3.2 OAuth izin ekranı (Google Auth Platform)
- **Audience → User type: External.** Kurumsal (Workspace) Google hesabı olmayan geliştirici "Internal" seçemez; External doğru seçimdir.
- **Branding** (bunlar olmadan "Publish app" düğmesi kapalı kalır):
  | Alan | Değer |
  |---|---|
  | App name | NetERP |
  | User support email / Developer contact | admin@iq-sense.com.tr |
  | App logo | **Boş bırak** (logo eklemek Google incelemesini başlatır) |
  | Application home page | `https://yontem-erp.vercel.app/tanitim.html` |
  | Privacy policy | `https://yontem-erp.vercel.app/gizlilik.html` |
  | Terms of service | `https://yontem-erp.vercel.app/kosullar.html` |
  | Authorized domains | `yontem-erp.vercel.app` |
- **Data Access (scopes)** — yalnız şunlar:
  - `openid`, `.../auth/userinfo.email`
  - `.../auth/drive.file` (hassas değil → Google incelemesi gerekmez)
  - ❌ `gmail.send` **ekleme**: hassas izin; incelemesiz uygulamada "Access blocked" verir.
- **Audience → Publish app.** "Testing" durumunda yalnız test kullanıcıları bağlanabilir ve Google bağlantıyı **7 günde bir düşürür**.

### 3.3 OAuth istemcisi
- *Clients → Create client → Web application*, ad: `NetERP Vercel`.
- **Authorized redirect URI:** `https://yontem-erp.vercel.app/api/baglanti/google/donus`
  (Alan adı değişirse buraya yenisi eklenir; kod dönüş adresini isteğin geldiği alan adından üretir, `GOOGLE_REDIRECT_URI` ile sabitlenebilir.)

### 3.4 (B yolu için) Hizmet hesabı
1. *IAM & Admin → Service Accounts → Create*: `neterp-drive`, rol verme.
2. Hesap → *Keys → Add key → JSON*.
3. "Service account key creation is disabled" hatası: *IAM & Admin → Organization Policies* → `iam.disableServiceAccountKeyCreation` → bu proje için **Override → Off** (Organization Policy Administrator rolü gerekir).

### 3.5 Vercel ortam değişkenleri (Production)
| Değişken | İçerik | Yol |
|---|---|---|
| `GOOGLE_CLIENT_ID` | OAuth Client ID | A |
| `GOOGLE_CLIENT_SECRET` | OAuth Client secret (Sensitive) | A |
| `GOOGLE_SERVICE_ACCOUNT` | Hizmet hesabı JSON dosyasının tamamı (Sensitive) | B |
| `BAGLANTI_ANAHTAR` *(isteğe bağlı)* | Belirteç şifreleme anahtarı; yoksa `OTURUM_GIZLI`'den türetilir | A |

> Vercel yeni değişkenleri **ancak yeni yayında** okur: değişken ekledikten sonra yeniden yayın (redeploy) gerekir.
> Gizli değerler sohbete/e-postaya yapıştırılmaz; doğrudan Vercel'e girilir.

---

## 4. Müşteri kullanımı (ERP içinde)

**Ayarlar → Firma → Bulut depolar → Google Drive**

**A) Kişisel Drive**
1. **Kişisel Drive'ı bağla** → Google hesabını seç.
2. "Bu uygulama doğrulanmadı" uyarısı çıkarsa *Gelişmiş → devam et*.
3. İzin ekranında **"Google Drive dosyalarını görme, düzenleme, oluşturma…" kutusunu işaretle** → Devam.
4. ERP'ye dönülür: "Bağlı · hesap · dosyalar Drive'ım/NetERP klasörüne". Varsayılan depo otomatik **Google Drive** olur.

**B) Paylaşılan Drive** (Workspace)
1. Google Drive → sol menü *Paylaşılan Drive'lar* → *+ Yeni* (ör. NetERP).
2. Drive adına sağ tık → *Üyeleri yönet* → ekranda gösterilen ERP adresini (Kopyala) ekle, rol **İçerik yöneticisi**, *Kişileri bilgilendir* kapalı.
3. ERP'de **Kontrol et ve bağla**. Birden çok Drive görünürse hangisi olduğu sorulur.

**Bağlantıyı kesmek:** aynı ekranda *Bağlantıyı kes*. Drive'daki dosyalar silinmez; yeni dosyalar sunucuya gider. Ayrıca Google hesabından: https://myaccount.google.com/permissions

---

## 5. Sorun giderme (yaşadıklarımız)

| Belirti | Sebep | Çözüm |
|---|---|---|
| Düğme "Kurulum gerekli", "Sunucu ayarı eksik" | Vercel'de `GOOGLE_CLIENT_ID/SECRET` yok ya da eklendikten sonra yayın yenilenmedi | Değişkenleri ekle → redeploy |
| **Access blocked: … has not completed the Google verification process** | Hassas izin (`gmail.send`) isteniyordu ve/veya uygulama "Testing"te, hesap test kullanıcısı değil | `gmail.send` kaldırıldı (kod + Data Access). Publish et ya da hesabı test kullanıcısı ekle |
| **Publish app** gri | Branding'de ana sayfa / gizlilik / koşullar adresleri boş | 3.2'deki üç sayfa adresi + authorized domain → Save |
| "Make internal" seçilemiyor | Geliştirici hesabı bir Workspace kurumuna bağlı değil | Gerek yok, External kullan |
| Bağlandı ama dosya Drive'a gitmedi; büyük dosya "Google Drive" etiketli ama içeriksiz | İzin ekranında **Drive kutusu işaretlenmemiş**: Google yalnız `openid email` verdi | ERP artık kırmızı "Drive izni verilmedi" + **Yeniden bağla** gösterir; içeriksiz satır oluşturmaz |
| "Kontrol et" → "henüz paylaşım görünmüyor" | Paylaşılan Drive yerine *Drive'ım*'daki klasör paylaşılmış, ya da Workspace dış üye eklemeyi engelliyor | ERP normal klasör paylaşıldıysa adını söyler. admin.google.com → Drive ve Dokümanlar → Paylaşım ayarları |
| Kişisel hesapta "Paylaşılan Drive'lar" yok | Yalnız Workspace hesaplarında var | A yolu (Kişisel Drive'ı bağla) |
| 7 gün sonra "Bağlantı düştü" | Uygulama "Testing" durumunda | Publish app; o zamana kadar *Yeniden bağla* |

Sunucu kayıtlarında (Vercel → Logs) `google durum: drive true/false kapsam …` satırı Google'ın hangi izinleri verdiğini gösterir.

---

## 6. Teknik yapı

**Dosyalar**
- `src/baglanti/kasa.js` — belirteç kasası: AES-256-GCM, anahtar `BAGLANTI_ANAHTAR` ya da `OTURUM_GIZLI`'den HKDF. `ayarlar` tablosunda `baglanti:<ad>` anahtarıyla şifreli satır. Belirteçler tarayıcıya hiç gitmez.
- `src/baglanti/google.js` — OAuth (offline, `prompt=consent`), belirteç yenileme, `invalid_grant` → "kopuk"; NetERP/<kod> klasörü; resumable yükleme; Workspace alanında "bağlantıyı bilen görür" izni.
- `src/baglanti/driveHesap.js` — hizmet hesabı: RS256 JWT → erişim belirteci (bellekte önbellek), Paylaşılan Drive listesi/doğrulama (`canAddChildren`), `supportsAllDrives` ile klasör ve yükleme.
- `src/routes/baglanti.js` — uçlar (aşağıda).
- `public/tanitim.html`, `gizlilik.html`, `kosullar.html` — Google Branding için herkese açık sayfalar (gizlilikte *Limited Use* beyanı).
- `test/baglanti.test.js` — 13 test (sahte fetch, bellek içi DB, gerçek RSA ile JWT doğrulama).

**Uçlar**
| Uç | Yetki | İş |
|---|---|---|
| `GET /api/baglanti/durum` | giriş | Google/Drive durumu (yönetici dışına hesap ayrıntısı verilmez) |
| `POST /api/baglanti/google/basla` | yönetici | İzin adresi (imzalı, 10 dk geçerli `state`) |
| `GET /api/baglanti/google/donus` | oturum + yönetici | Kod → belirteç → kasa; `/?baglanti=google&sonuc=…` yönlendirmesi |
| `POST /api/baglanti/google/kes` | yönetici | Belirteci Google'da iptal + kasadan sil |
| `GET /api/baglanti/gdrive/suruculer` | yönetici | Hizmet hesabının üye olduğu Paylaşılan Drive'lar (+ yanlış paylaşılan klasör tanısı) |
| `POST /api/baglanti/gdrive/sec` · `/kes` | yönetici | Paylaşılan Drive bağla / kes |
| `POST /api/dosya/yukle/basla` | giriş + modül okuma | Klasörü bul/kur, Google yükleme oturumu aç; oturum adresi **şifreli**, kullanıcıya ve 6 saate bağlı |
| `POST /api/dosya/yukle/parca?bas=N` | giriş | Ham gövde (≤ 3,75 MB, 256 KB katı), Google'a `Content-Range` ile iletir |

**Yükleme akışı:** tarayıcı → `basla` → (3,75 MB parça × n) `parca` → Google `308` (devam) / `200` (bitti) → kayda `url`, `dosyaId`, `klasor` yazılır. Parça boyutu Vercel'in 4,5 MB istek sınırının altında ve hem Google (256 KB) hem OneDrive (320 KB) katı. Yükleme sürerken kayıt kaydedilmez.

---

## 7. Açık işler
- [ ] Google'da **Publish app** (7 günlük test sınırı kalksın).
- [ ] Kalıcı alan adı (ör. `erp.iq-sense.com.tr`): Google marka doğrulaması istenirse ana sayfa doğrulanmış bir alan adında olmalı; dönüş adresi ve Authorized domains güncellenir.
- [ ] Paylaşılan Drive (B yolu) bir Workspace hesabıyla uçtan uca deneme.
- [ ] Kişisel Drive'da (Workspace değil) dosyaları ERP'deki diğer kullanıcılar Drive'dan açamaz; gerekirse ERP üzerinden indirme vekili.
- [ ] Gizli (önem: Gizli) dosyalarda Drive paylaşımını kısıtlama.
- [ ] Bağlantı **farklı bir Google hesabıyla** yeniden kurulursa eski dosyalar o hesapta olmadığı için ERP'den yönetilemez (aynı hesapla yeniden bağlanmada sorun yok). Gerekirse hesap değişiminde uyarı.
