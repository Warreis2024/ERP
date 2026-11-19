# Yöntem ERP

Durum tabanlı, fonksiyonlarla kurulan modüler ERP. Modüller Ayarlar'dan açılır, alanlar yeniden kullanılabilir "fonksiyon"lardan bağlanır, her kayıt bir projeye bağlıdır.

Proje kuralları, ekran açıklamaları ve test listesi claude.ai projesindeki **README.md** belgesindedir; bu depo onun sunucu ve uygulama kodudur.

## Yapı

```
api/index.js            Vercel giriş noktası
server.js               Yerel / IIS (Windows servisi) giriş noktası
src/
  app.js                Express uygulaması, güvenlik başlıkları, yönlendirme
  config.js             Ortam değişkenleri
  db.js                 Knex bağlantıları (PostgreSQL / MS SQL), firma başına havuz
  tenant.js             Firma çözümleme (alt alan adı → veritabanı)
  auth/                 Oturum belirteci, şifre özeti, ara katmanlar (kimlik, CSRF, yetki)
  kurallar/             Saf iş kuralları: değerler, yetki, silme, log farkı (test edilir)
  kayitServis.js        Proje / kayıt kaydetme, durum, silme
  veri.js               Ortak veri erişimi (tanımlar, kod üretimi, log)
  routes/               API uçları
migrations/             Firma veritabanı şeması (PostgreSQL ve MS SQL için aynı)
migrations-katalog/     Çoklu firma kataloğu
seeds/                  Şablondaki tanımlar ve örnek veri
public/                 Arayüz (index.html: API denetimi; sablon.html: bugünkü prototip)
docs/KURULUM.md         Yerel, Vercel + Supabase, IIS + MS SQL kurulumu
docs/API.md             Uçlar
test/                   İş kuralı testleri (npm test)
```

## Hızlı başlangıç

```bash
npm install
cp .env.example .env     # DATABASE_URL, OTURUM_GIZLI…
npm run migrate
npm run seed
npm run dev
```

Ayrıntı: [docs/KURULUM.md](docs/KURULUM.md).

## Durum

- [x] Şema: projeler, kayıtlar, ortak değer tablosu, log, kullanıcı / yetki, tanımlar
- [x] Giriş, oturum, CSRF, şifre politikası, kilit
- [x] Sunucuda yetki: modül, fonksiyon (Düzenle / Gör / Görme), gizli dosya, kapanış onayı
- [x] Proje / kayıt API'si: kaydet, durum, silme kuralı, alan logu, mesaj
- [x] Ayarlar API'si (yönetici)
- [ ] Arayüzün API'ye bağlanması (sablon.html → modüller)
- [ ] Dosya deposu adaptörleri (Supabase Storage, disk, NAS)
- [x] Google Drive: ERP hizmet hesabı + müşterinin Paylaşılan Drive'ı (Ayarlar → Firma → Bulut depolar sihirbazı).
  - Satıcı bir kez: Google Cloud'da hizmet hesabı + JSON anahtar → Vercel `GOOGLE_SERVICE_ACCOUNT`.
  - Müşteri: Paylaşılan Drive açar, hizmet hesabı adresini "İçerik yöneticisi" ekler, "Kontrol et" der.
  - Hizmet hesaplarının depolama kotası yok; bu yüzden kişisel Drive klasörü değil Paylaşılan Drive kullanılır.
  - Yedek: kişisel Drive'a OAuth (yalnız `drive.file`, hassas değil). Gmail izni istenmez (hassas izin, Google doğrulaması ister).
- [x] OneDrive (kişisel + Microsoft 365) OAuth bağlantısı, NetERP/<proje kodu> — kurulum: [docs/ONEDRIVE.md](docs/ONEDRIVE.md). Google: [docs/GOOGLE-DRIVE.md](docs/GOOGLE-DRIVE.md).
- [ ] SharePoint belge kitaplığı seçeneği.
  - Firma hesabında kök klasör **`NetERP`** açılır; her projenin dosyaları proje kodu altında toplanır: `NetERP/PRJ-1048`.
    Proje kodu değişmez olduğu için klasör adı koddur (proje adı değişse de klasör kaymaz); klasör açıklamasına proje adı yazılır.
  - Projedeki kayıtların (servis, CRM…) dosyaları aynı proje klasöründe, kendi kodlarıyla alt klasörde: `NetERP/PRJ-1048/SRV-1001`.
  - Kurulum: Google Cloud OAuth istemcisi / Microsoft Entra uygulama kaydı, dönüş adresi `https://<alan>/api/baglanti/<saglayici>/donus`, istemci kimliği ve gizli anahtar Vercel ortam değişkeni; belirteç sunucuda şifreli saklanır.
- [x] Firma e-postası SMTP ile gönderim (Ayarlar → Firma → E-posta → "Test et ve kaydet"): harici paket olmadan SMTP istemcisi (`src/baglanti/smtp.js`, STARTTLS 587 / SSL 465, AUTH PLAIN/LOGIN), şifre bağlantı kasasında şifreli; kayıttan "Gönder" firma hesabından, cevap adresi gönderen kullanıcı. Vercel port 25'i engeller; 465/587 açık.
- [ ] Gelen e-postalar (IMAP) ve kullanıcının kendi hesabıyla gönderim (Profilim).
- [ ] Kiosk, çıktı formu, gelen kutusu, e-posta uçları
