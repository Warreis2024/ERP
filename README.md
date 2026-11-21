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
- [x] Kullanıcının kendi hesabıyla gönderim (Profilim → E-posta hesabım → SMTP → Test et ve kaydet); şifre kullanıcıya özel kasada. Firma ayarında "Kullanıcılar kendi e-posta hesabını bağlayabilir" açık olmalı. Öncelik: kendi hesabı → firma hesabı → e-posta programı.
- [ ] Gelen e-postalar (IMAP); Google/Microsoft hesabıyla doğrudan (OAuth) kişisel gönderim.
- [ ] Kiosk, çıktı formu, gelen kutusu, e-posta uçları
- [x] Çoklu dil (Türkçe / English / Deutsch / Español)
- [x] Mobil uygulama (PWA, `/m/`): QR ile şifresiz eşleme, bildirim, mesaj, hızlı not, sesli not, dikte, fotoğraf/video
- [ ] Mobil: ayrı Android APK dosyası (şimdilik Chrome "Yükle" ile WebAPK); AI özellikleri

## Kural katmanı, aktarım, efor, misafir, açık form, ticket (21.11.2026)

Kararlar ve tasarım: ERP projesi → `yapilacaklar.md`.

- [x] **Alan / fonksiyon kilidi.**
  - Fonksiyon ayarında "Değiştirebilir" seçeneği var: yetki grubuna göre / kaydı açan + yönetim / yalnız yönetim / kaydedildikten sonra kilitli.
  - Kural sunucuda uygulanır. Kilitli alan formda salt okunur görünür.
- [x] **Yetkiye bağlı durum değişimi.**
  - Durum ayarında "Bu duruma kim geçirebilir" seçeneği var: herkes / yalnız kaydı açan / açan + yönetim.
  - Kural form kaydında ve kanbanda sürüklemede geçerlidir.
- [x] **Fiyat onayı.**
  - Kullanıcı kartında "Yöneticisi" ve TL / USD / EUR onay limitleri tanımlanır.
  - "Fiyat Onayı" fonksiyonu tutar ve para birimi taşır. Limit aşılırsa onay, yönetici zincirinde limiti yeten ilk kişiye gider.
  - Bu üç para birimi dışındakiler TCMB kuruyla TL'ye çevrilir. Yönetim limitsizdir.
  - Onaylayan masaüstünde ya da telefonda onaylar veya reddeder; bildirim gider.
  - Onay beklerken seçilen durumlara geçilemez. Hiçbiri seçilmezse "akışı kapatır" durumlarına geçilemez.
  - Tutar değişirse onay yeniden hesaplanır.
- [x] **Kayıttan kayda aktarım.**
  - Modül ayarında "Aktarımlar" tanımlanır: hedef modül, tetikleyen durum, hedef durum, alan eşleme, atama.
  - Kayıt tetikleyen duruma geçince hedef form, kaynaktaki bilgilerle dolu açılır. Eksik zorunlu alanlar kırmızı çerçeveyle işaretlenir.
  - Kayıt yalnız kaydedilince açılır. Kayıttaki "… aktar" düğmesi de aynı işi yapar.
  - Bir kayıttan her aktarımla tek kayıt açılır; kaynak kayıt açık kalır.
  - Bağlı kayıtlar iki tarafta da görünür (`kayit_baglari` tablosu).
- [x] **Efor (Zaman Takibi).**
  - Fonksiyondur; kayıtta Başla / Mola / Devam / Bitir düğmeleri vardır. Satırlar anında yazılır.
  - Kişi başına net çalışma ve mola toplamı görünür.
  - Başka bir işte "Başla" denince önceki iş durdurulur.
  - Üst çubukta açık sayaç görünür. Dünden kalan ya da 10 saati geçen sayaç kırmızı uyarı verir.
  - Telefonda da düğmeler ve "şu an çalıştığın iş" bandı vardır.
- [x] **Misafir kullanıcı.**
  - Kullanıcı türü "Misafir" olabilir. Normal kullanıcı gibi şifreyle girer; yetkileri yetki grubundan gelir.
  - Tarih, gün ve saat (İstanbul saati) dışında yeni giriş yapamaz; açık oturumu kapanmaz.
  - Kartında Firma ve görünürlük seçimi vardır:
    - yalnız kendi kayıtları (açtığı ya da kişi alanında adı geçen),
    - ya da firmasının kayıtları da.
  - Kapsam dışındaki kayıtlar sunucuda süzülür.
- [x] **Açık form bağlantısı.**
  - Modül ayarında şablon ([[Alan]]), proje ve durum seçilir; kalıcı bir bağlantı ve QR üretilir (`/onay.html#f=…`).
  - Formu doldurmak modülde yeni kayıt açar. Cevaplar aynı adlı fonksiyonlara yazılır. Doldurulmuş belge, modülde Şablon fonksiyonu varsa saklanır.
  - Dolduran kişiye takip bağlantısı verilir (`#t=…`); e-posta yazdıysa bağlantı ona e-postayla da gider.
  - Kötüye kullanıma karşı:
    - hız sınırı,
    - tuzak alanı,
    - en az 3 saniyelik doldurma süresi.
- [x] **Ticket fonksiyonu.**
  - Modüle bağlı IMAP kutusu kontrol edilir; okunmamış her e-posta yeni kayıt açar.
  - Konuda kayıt kodu olan yanıtlar o kayda mesaj olarak eklenir.
  - Gönderen, rehberdeki e-postasıyla firmaya bağlanır.
  - Kutu, modül açılınca en çok 2 dakikada bir kontrol edilir; "E-posta" düğmesiyle hemen de kontrol edilebilir. AI ile sınıflandırma sonra eklenecek.
- [ ] **Performans ölçeği (adam/saat).** Efor verisi birikince panolara eklenecek; ölçüt henüz seçilmedi.
- [ ] Muhasebe programına fatura aktarımı; yönetici izindeyken onay vekili.

## Veritabanı bakımı (21.11.2026)

- **Göç `20261121000003_bakim`**: `kayit_baglari(kaynak_id, aktarim)` tekil (aynı kayıt aynı aktarımla iki kez aktarılamaz; yarışta 409 döner); eksik indeksler (`degerler(fn_tip,kisi)`, `degerler(fn_tip,guncelleme)`, `log(modul_id,id)`, `kartlar/projeler.durum_id`, `kullanicilar.grup_id`, `proje_kisileri.kullanici_id`, `rehber_kisiler.firma_id`); PostgreSQL'de tüm saat dilimsiz zaman sütunları `timestamptz` (UTC kabul edilerek); `projeler.arsiv_tarihi`.
- **Kişi bağları**: kişi/ekip alanları kullanıcıyı zaten **id** ile tutar (`degerler.kisi = u…`), ad değişikliği bağı bozmaz; rehber kişileri `kisi_id` (ks…) ile bağlıdır. Ada göre eşleşen eski satır yok.
- **Arşiv temizliği** (`src/bakim.js` → `arsivTemizle`): proje arşivlenince o projenin silindi işaretli kayıtları, değerleri, bağları, dış onayları, form takipleri ve e-posta kayıtları kalıcı silinir; süresi geçmiş yanıtsız dış onaylar da silinir. İşlem günlüğü (`log`) silinmez, projeye "Arşiv bakımı" satırı yazılır. Önceden arşivlenmiş projeler için Ayarlar → Firma → **Bakım → Şimdi temizle** (kaydı olmayan bağlar ve 1 yıldan eski giriş kayıtları da temizlenir).
- **Depoya süpür** (`depoyaSupur`): 3 yıldan uzun süredir arşivdeki projelerin veritabanına gömülü dosyaları (doküman `url` data URL'leri, mesaj ekleri) firmanın bulut deposuna (`NetERP/<proje kodu>`) yüklenir, kayıtta bulut bağlantısı kalır. İmzalar ve zengin metin içindeki resimler taşınmaz. Her istek ~20 sn / 40 satır işler; arayüz kalan bitene kadar tekrarlar. Uçlar: `GET /api/bakim/ozet`, `POST /api/bakim/arsiv`, `POST /api/bakim/supur` (yalnız yönetici).
