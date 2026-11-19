# OneDrive Entegrasyonu — NetERP

Son güncelleme: 20 Kasım 2026 · Durum: **Kod hazır ve yayında, testler geçiyor (sahte Microsoft yanıtlarıyla). Gerçek hesapla henüz denenmedi.** Satıcı kurulumu (bölüm 3) yapılınca uçtan uca test edilecek.

Google Drive'ın kişisel yolu (bkz. `GOOGLE-DRIVE.md`) ile aynı mantık: müşteri ERP'de **"OneDrive'ı bağla"** der, Microsoft bir kez izin ister, iş biter.

---

## 1. Ne yapıyor?

Bağlandıktan sonra kayıtlara eklenen dosyalar bağlanan hesabın OneDrive'ına gider:

```
OneDrive
└── NetERP/
    ├── PRJ-1042/
    │   └── Hidrolik-semasi.pdf
    ├── PRJ-1048/
    └── Genel/          ← projeye bağlı olmayan dosyalar
```

- Klasör adı proje kodu. OneDrive'da yasak karakterler (`" * : < > ? / \ |`) `_` olur.
- Aynı adlı dosya varsa üzerine yazılmaz; OneDrive yeni adı kendisi verir (ör. `rapor 1.pdf`).
- Parça parça yükleme (3,75 MB; OneDrive'ın 320 KB kuralına uygun) → boyut sınırı pratikte yok. Boş (0 bayt) dosya doğrudan yazılır.
- **İş hesabında (Microsoft 365)** yüklenen dosya için *kuruluş içi görüntüleme bağlantısı* üretilir: aynı şirketteki herkes bağlantıyla açabilir. **Kişisel hesapta** paylaşım yapılmaz; dosyayı yalnız bağlanan hesap açar.

---

## 2. Hangi hesaplar?

| Hesap | Çalışır mı | Not |
|---|---|---|
| Kişisel Microsoft (Outlook, Hotmail, Live) | ✅ | İzin ekranında "doğrulanmamış yayıncı" yazabilir; kullanıcı yine izin verebilir. |
| İş/okul (Microsoft 365) — bizim uygulamayı kaydettiğimiz dizin | ✅ | |
| İş/okul — **başka firmanın** Microsoft 365'i | ⚠️ | Microsoft, yayıncısı doğrulanmamış çok kiracılı uygulamalarda kullanıcının kendi izin vermesini çoğu kuruluşta engelliyor. O firmanın **Microsoft 365 yöneticisi bir kez "kuruluş adına kabul et"** der; ya da biz **yayıncı doğrulaması** (Microsoft AI Cloud Partner Program, ücretsiz; şirket kimliği ve alan adı ister) yaparız. |

**Müşteri hiçbir zaman** Azure/Entra portalına ya da Vercel'e girmez. Bölüm 3 yalnız bizim (IQ-Sense) bir kez yaptığımız iştir.

---

## 3. Satıcı kurulumu (bir kez, IQ-Sense) — adım adım

> Kurumsal Microsoft hesabı gerekmez. Ancak Microsoft artık kişisel hesabın **dizin (tenant) dışında** uygulama kaydı açmasına izin vermiyor; uygulama bir dizine kaydedilmeli. Kişisel hesapla bunun en kolay yolu ücretsiz Azure hesabı açmaktır (bir "Default Directory" oluşturur).

1. **Dizin edin (yalnız ilk kez).** https://portal.azure.com adresine kişisel Microsoft hesabınla gir.
   - Üstte bir dizin adı görünüyorsa (*Default Directory* vb.) ve *Microsoft Entra ID* menüsü açılıyorsa → 2. adıma geç.
   - "Hesabınız bir dizinle ilişkili değil" ya da **AADSTS16000** gibi bir uyarı çıkarsa: https://azure.microsoft.com/free → **Ücretsiz başla**. Kimlik doğrulaması için kart istenebilir; ücretsiz katmanda ücret alınmaz. Bitince portal bir dizinle açılır.
2. **Uygulama kaydı aç.** Portalda arama: **Microsoft Entra ID** → sol menü *App registrations* → **+ New registration**.
   - Name: `NetERP`
   - **Supported account types:** *Accounts in any organizational directory (Any Microsoft Entra ID tenant – Multitenant) **and personal Microsoft accounts** (e.g. Skype, Xbox)* — en alttaki seçenek. Yanlış seçilirse kişisel hesaplar "AADSTS50020 / bu uygulamaya kişisel hesapla girilemez" hatası alır.
   - Redirect URI: platform **Web**, adres tam olarak:
     `https://yontem-erp.vercel.app/api/baglanti/microsoft/donus`
   - **Register**.
3. **Kimliği kopyala.** Açılan *Overview* sayfasında **Application (client) ID** değerini kopyala (Vercel'de `MS_CLIENT_ID`).
4. **Gizli anahtar oluştur.** Sol menü *Certificates & secrets* → *Client secrets* → **+ New client secret** → Description: `Vercel`, Expires: **24 months** → Add.
   - Tabloda iki değer çıkar: **Value** ve *Secret ID*. **Value**'yu hemen kopyala (sayfadan çıkınca bir daha görünmez). *Secret ID* değil! (Yanlışını girersen hata: AADSTS7000215.)
   - 📅 **Takvime hatırlatma koy:** 24 ay sonra anahtarın süresi biter (hata: AADSTS7000222). Yenisini oluşturup Vercel'de değiştirmek gerekir.
5. **İzinleri ekle.** Sol menü *API permissions* → **+ Add a permission** → *Microsoft Graph* → **Delegated permissions** → şunları işaretle → *Add permissions*:
   - `Files.ReadWrite`
   - `offline_access`
   - `User.Read` (genelde zaten ekli)
   "Grant admin consent" düğmesine basmak gerekmez.
6. **Marka bilgileri (önerilir).** Sol menü *Branding & properties*:
   - Home page URL: `https://yontem-erp.vercel.app/tanitim.html`
   - Terms of service URL: `https://yontem-erp.vercel.app/kosullar.html`
   - Privacy statement URL: `https://yontem-erp.vercel.app/gizlilik.html`
   - Logo: isteğe bağlı. Save.
7. **İki değeri Vercel'e gir.** https://vercel.com → `yontem-erp` → *Settings* → *Environment Variables* → *Add New* (Environment: **Production**):
   - `MS_CLIENT_ID` = Application (client) ID
   - `MS_CLIENT_SECRET` = secret **Value** (*Sensitive* işaretle)
   Save → **yeniden yayın** (*Deployments → son yayın → ⋯ → Redeploy*). Vercel yeni değişkenleri ancak yeni yayında okur.
8. **ERP'de bağla.** Bölüm 4.

İsteğe bağlı değişkenler: `MS_TENANT` (varsayılan `common`; yalnız kendi dizinindeki hesaplara izin vermek için dizin kimliği), `MS_REDIRECT_URI` (dönüş adresini sabitlemek için).

---

## 4. Müşteri kullanımı (ERP içinde)

**Ayarlar → Firma → Bulut depolar → OneDrive**

1. **OneDrive'ı bağla** → Microsoft hesabını seç (Outlook/Hotmail ya da şirket hesabı).
2. İzin ekranında istenenler: *Dosyalarınıza erişim, Profilinizi okuma, Erişim izni verdiğiniz verilere erişimi sürdürme* → **Kabul et / Accept**.
   - Şirket hesabında "Yönetici onayı gerekiyor" çıkarsa: firmanın Microsoft 365 yöneticisi aynı düğmeyle girip **"Kuruluşunuz adına onay verin"** kutusunu işaretleyerek kabul eder (bir kez).
3. ERP'ye dönülür: **"Bağlı · hesap · dosyalar OneDrive/NetERP klasörüne"**. Varsayılan dosya deposu otomatik **OneDrive** olur.
4. Bir projeye dosya ekle → satırda **"OneDrive yükleniyor · %…"** → bitince kaydet → OneDrive'da `NetERP/PRJ-…` klasörüne bak.

Google Drive da bağlıysa dosyaların nereye gideceğini **Varsayılan dosya deposu** seçimi belirler.

**Bağlantıyı kesmek:** aynı ekranda *Bağlantıyı kes* (OneDrive'daki dosyalar silinmez). Kullanıcı izni Microsoft tarafından da kaldırabilir: kişisel hesapta https://account.live.com/consent/Manage , iş hesabında https://myapps.microsoft.com → uygulama → izinleri iptal.

---

## 5. Sorun giderme

Microsoft hataları `AADSTS` + numara ile gelir; ERP bilinenleri Türkçe mesaja çevirir. Ham kod Vercel kayıtlarında görünür.

| Hata / belirti | Sebep | Çözüm |
|---|---|---|
| Düğme "Kurulum gerekli", "Sunucu ayarı eksik (MS_CLIENT_ID…)" | Vercel'de değişkenler yok ya da yayın yenilenmedi | 3.7 → Redeploy |
| **AADSTS50011** redirect URI uyuşmuyor | Kayıttaki Redirect URI farklı (http/https, sondaki `/`, alan adı) | 3.2'deki adresi birebir gir (*Authentication* sayfası) |
| **AADSTS7000215** geçersiz istemci gizli anahtarı | `MS_CLIENT_SECRET`'e *Secret ID* girilmiş | Secret'ın **Value**'sunu gir (gerekirse yeni secret) |
| **AADSTS7000222** gizli anahtarın süresi dolmuş | 24 ay doldu | Yeni secret → Vercel → Redeploy |
| **AADSTS700016** uygulama bulunamadı | `MS_CLIENT_ID` yanlış ya da hesap türü desteklenmiyor | Client ID'yi kontrol et |
| **AADSTS50020** / "kişisel hesapla girilemez" | *Supported account types* yalnız kuruluş hesapları | *Authentication* → hesap türünü "…and personal Microsoft accounts" yap (değiştirilemiyorsa yeni kayıt) |
| **AADSTS65001 / 90094** "Yönetici onayı gerekiyor" | Başka firmanın Microsoft 365'i, kullanıcı onayı kapalı/yayıncı doğrulanmamış | O firmanın M365 yöneticisi kuruluş adına onaylar; kalıcı çözüm yayıncı doğrulaması |
| **AADSTS16000** portalda dizin yok | Kişisel hesabın dizini yok | 3.1: ücretsiz Azure hesabı |
| Kırmızı "dosya izni verilmedi" | İzin ekranında dosya izni reddedilmiş | *Yeniden bağla* → kabul et |
| "Bağlantı düştü" | İzin geri alındı, şifre değişti ya da uzun süre kullanılmadı (yenileme belirteci ~90 gün kullanılmazsa düşer) | *Yeniden bağla* |
| Şirket arkadaşı dosyayı açamıyor | Kişisel hesap: paylaşım yapılmaz | İş hesabıyla bağlayınca kuruluş içi bağlantı üretilir |

Vercel kayıtlarında `microsoft durum: dosya true/false tur personal|business kapsam …` satırı Microsoft'un verdiği izinleri gösterir.

---

## 6. Teknik yapı

**Dosyalar**
- `src/baglanti/microsoft.js` — OAuth v2 (`common` uç), `offline_access User.Read Files.ReadWrite`; belirteç yenileme (Microsoft her yenilemede yeni yenileme belirteci döndürür, saklanır), `invalid_grant` → kopuk; AADSTS → Türkçe mesaj; `NetERP/<kod>` klasörü (yoksa oluştur, eşzamanlı oluşturmada 409 → yeniden oku); `createUploadSession` (aynı ad → *rename*); parça yükleme (yükleme adresine **Authorization gönderilmez**, 202 → `nextExpectedRanges`); iş hesabında `createLink` (view / organization).
- `src/baglanti/kasa.js` — belirteçler `ayarlar` tablosunda `baglanti:microsoft` anahtarıyla AES-256-GCM şifreli (Google ile ortak).
- `src/routes/baglanti.js` — uçlar (aşağıda); Google ile aynı yükleme uçları `depo: 'onedrive'` ile.
- Arayüz: `onedriveSatirHTML`, `ms-bagla` / `ms-kes`, `driveYukle(f, rows, file, depo)`, `bulutHazir()`.
- Testler: `test/baglanti.test.js` — 7 Microsoft testi (izin adresi, kod takası, AADSTS mesajları, yenileme + belirteç dönüşümü, kopuk, klasör oluşturma, parça yükleme ve yetki başlığı gönderilmemesi, yasak karakter, kişisel hesapta paylaşım yok).

**Uçlar**
| Uç | Yetki | İş |
|---|---|---|
| `GET /api/baglanti/durum` | giriş | `microsoft: {yapilandirildi, bagli, dosya, hesap, surucuTur…}` |
| `POST /api/baglanti/microsoft/basla` | yönetici | İzin adresi (imzalı 10 dk `state`) |
| `GET /api/baglanti/microsoft/donus` | oturum + yönetici | Kod → belirteç → `/me`, `/me/drive` → kasa; `/?baglanti=microsoft&sonuc=…` |
| `POST /api/baglanti/microsoft/kes` | yönetici | Kasadan sil |
| `POST /api/dosya/yukle/basla` `{depo:'onedrive'}` | giriş + modül | Klasör + yükleme oturumu (şifreli, kullanıcıya ve 6 saate bağlı); 0 bayt → doğrudan |
| `POST /api/dosya/yukle/parca?bas=N` | giriş | Parçayı OneDrive yükleme adresine iletir |

---

## 7. Açık işler
- [ ] Satıcı kurulumu (bölüm 3) ve gerçek hesapla uçtan uca test (kişisel + varsa iş hesabı).
- [ ] Başka firmaların Microsoft 365 hesapları için **yayıncı doğrulaması** (Microsoft AI Cloud Partner Program + `iq-sense.com.tr` alan adı) — yoksa her firmada M365 yöneticisi onayı.
- [ ] Gizli anahtar süresi için ERP içinde hatırlatma (24 ay).
- [ ] SharePoint belge kitaplığı (şirketin ortak alanı) seçeneği — Google'daki Paylaşılan Drive'ın karşılığı.
- [ ] Kalıcı alan adı gelince Redirect URI ve marka adreslerinin güncellenmesi.
