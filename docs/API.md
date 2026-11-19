# API

Bütün uçlar `/api` altındadır ve JSON döner. Oturum çerezle taşınır. `GET` dışındaki her istekte `X-CSRF-Token` başlığı gerekir; değeri `erp_csrf` çerezinden okunur.

Hata biçimi: `{ "hata": "Açıklama", ...ek }`.

| Kod | Anlamı |
|---|---|
| 400 | Geçersiz veri ya da kural ihlali (zorunlu alan, kontrol listesi…) |
| 401 | Oturum yok |
| 403 | Yetki yok. `kod: "SIFRE_DEGISMELI"` ise önce şifre değiştirilmeli. |
| 404 | Bulunamadı |
| 409 | Çakışma (kullanımdaki durum ya da fonksiyon silinemez) |
| 429 | Çok fazla deneme |

## Oturum
| Yöntem | Yol | Gövde / açıklama |
|---|---|---|
| POST | `/oturum/giris` | `{ eposta, sifre, hatirla? }` → `{ ok, csrf, sifreDegismeli }` |
| POST | `/oturum/cikis` | Bu tarayıcıdaki oturumu kapatır |
| POST | `/oturum/cikis-hepsi` | Bütün cihazlardaki oturumları kapatır |
| GET | `/oturum/ben` | Kullanıcı, firma, son girişler |
| POST | `/oturum/sifre` | `{ eski, yeni }` (en az 8 karakter, harf + rakam) |
| PUT | `/oturum/profil` | `{ ad?, tel?, foto?, tercih? }` (tercih: tema, açılış, görünüm…) |
| PUT | `/oturum/eposta-hesap` | Kullanıcı e-posta hesabı (şifre/OAuth belirteci burada tutulmaz) |

## Tanımlar
`GET /meta` şunları döner:
- firma ayarı;
- kullanıcı;
- görebildiği modüller (durumlar ve fonksiyonlar dahil; "Görme" fonksiyonlar çıkarılmış, her fonksiyonda `erisim`);
- opsiyonlar, yetki grupları, departmanlar;
- aktif kullanıcılar, depolar, malzemeler;
- şablonlar, panolar, çıktı formları; kiosklar yalnız yöneticiye;
- rehber.

## Projeler ve kayıtlar
| Yöntem | Yol | Açıklama |
|---|---|---|
| GET | `/projeler?arsiv=1&sayfa=1&adet=500` | Projeler + (ana modülü görebilene) proje alanları |
| GET | `/projeler/:id` | Proje + alanlar + log |
| POST / PUT | `/projeler`, `/projeler/:id` | `{ ad, durumId?, kategori?, arsiv?, yonetici[], ekip[], degerler[] }` |
| PATCH | `/projeler/:id/durum` | `{ durumId }` (kanbanda sürükle-bırak) |
| DELETE | `/projeler/:id` | README kuralı: ilk durumda ve işlem görmemişse kalıcı, değilse `silindi` → `{ kalici }` |
| GET | `/kartlar?modul=&proje=&durum=&sayfa=&adet=` | Kayıtlar + görünür değerleri |
| GET | `/kartlar/:id` | Kayıt + değerler + log |
| POST / PUT | `/kartlar`, `/kartlar/:id` | `{ modulId, projeId, durumId?, degerler[] }` |
| PATCH | `/kartlar/:id/durum` | `{ durumId }` |
| DELETE | `/kartlar/:id` | Silme kuralı |
| POST | `/mesaj` | `{ projeId, kartId?, fnUid, metin, ustId? }`: kaydı kaydetmeden mesaj |

`degerler[]` satırları şablondaki alan adlarını kullanır: `fnUid`, `metin`, `tarih`, `kisi`, `tutar`, `adet`, `not`…

Sunucunun uyguladığı kurallar:
- **Fonksiyon erişimi:** Yalnız kullanıcının "Düzenle" yetkisi olan fonksiyonlar istemciden alınır; diğerleri olduğu gibi korunur.
- **Zorunlu alanlar ve kontrol listesi:** Zorunlu alan dolu olmalı; "Uygun değil" maddesinde açıklama gerekir.
- **Kapanış onayı:** "Akışı kapatır" durumuna geçmek onay yetkisi ister.
- **Kayıt kodu:** Önek-1001'den başlayan kod sunucuda üretilir; eşzamanlı isteklerde çakışmaz.
- **Denetim alanları:** Kaydeden, kayıt tarihi, güncelleyen ve güncelleme tarihi sunucuda yazılır.
- **Log:** Yeni kayıt, durum değişimi ve fonksiyon bazında alan değişiklikleri (eski → yeni) loga düşer.
- **Mesaj ve doküman:** Mesajın yazarı ve zamanı, dokümanın yükleyeni sunucuda yazılır. Dosya onayını yalnız onay yetkilisi değiştirir.

## Arayüz durumu
- `GET /firma-genel`: oturum gerektirmez. Yalnız giriş sayfası için firma adı, alt alan ve logo döner.
- `GET /durum`: arayüzün (index.html) açılışta yüklediği bütün veri, şablonun kendi biçiminde.
  - Görünmeyen modül, gizli fonksiyon, gizli dosya ve yetkisiz değer gelmez.
  - Diğer kullanıcıların yetki ve hesap ayrıntıları yalnız yöneticiye gider.

Arayüz yeni kayıtta kendi kimliğini gönderir (`id`). Kimlik biçim ve teklik denetiminden geçerse kullanılır, yoksa 409 döner. Kayıt kodu (PRJ-1001) her zaman sunucuda üretilir.

## Ayarlar (yalnız yönetici)
Personel yalnız `rehber_firmalar`, `rehber_kisiler` ve `malzemeler` tablolarına yeni kayıt ekleyebilir (POST).

| Yöntem | Yol | Açıklama |
|---|---|---|
| GET/POST | `/ayar/:tablo` | Tablolar: `moduller, durumlar, fonksiyonlar, opsiyonlar, yetki_gruplari, departmanlar, depolar, malzemeler, rehber_firmalar, rehber_kisiler, sablonlar, panolar, kiosklar, ciktilar` |
| PUT/DELETE | `/ayar/:tablo/:id` | Kısmi güncelleme; kullanımdaki kayıt silinemez (409) |
| PUT | `/ayar/:tablo/sira/toplu` | `[id, id, …]` sırasıyla |
| PUT | `/ayar/firma` | Firma ayarı (logo, depo, NAS, e-posta…) |
| GET/POST | `/ayar/kullanicilar` | Yeni kullanıcıya geçici şifre üretilir (bir kez gösterilir; ilk girişte değişir) |
| PUT | `/ayar/kullanicilar/:id` | Ad, unvan, e-posta, rol, grup, departman, aktif |
| POST | `/ayar/kullanicilar/:id/sifre-sifirla` | Yeni geçici şifre; açık oturumlar düşer |
| PUT | `/ayar/kullanicilar/:id/yetkiler` | `{ modulId: { yetki, onay, disa } }` |

## Sıradaki uçlar
- Dosya yükleme / indirme (Supabase Storage, disk, NAS adaptörleri; imzalı ve süreli bağlantı)
- Kiosk okuma ucu (giriş yok, anahtarlı, salt okunur)
- Çıktı formu sorgusu (sunucuda, yetki süzgeçli)
- Gelen kutusu / okundu, e-posta gönderimi, bildirimler
