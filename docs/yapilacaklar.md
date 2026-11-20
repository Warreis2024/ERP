# Yapılacaklar — kararlar ve tasarım

Liste 20.11.2026 sabah not alındı, akşam konuşuldu. Aynı liste repoda `README.md` → "Kural katmanı, aktarım, efor, misafir, açık form, ticket" altında da var.

**Durum (20.11.2026 gece):** 1–8 arası maddeler yapıldı ve yayında. Açık kalanlar:
- 9 (performans),
- onay vekili,
- muhasebe aktarımı,
- ticket için AI.

---

## 1. Alan / fonksiyon kilidi — yapıldı
Yetki grubu yetkileri aynen kalır. Her fonksiyonun ayarında bir **"Değiştirebilir"** seçeneği bulunur:
- Yetki grubuna göre (bugünkü gibi)
- Kaydı açan + Yönetim
- Yalnız Yönetim
- Kaydedildikten sonra kilitli

Kural sunucuda uygulanır. İleride "şu durumdan sonra kilitli" seçeneği de eklenebilir.

## 2. Yetkiye bağlı durum değişimi — yapıldı
Durum ayarında **"Bu duruma kim geçirebilir"** seçeneği bulunur: herkes / kaydı açan / açan + Yönetim.

Örnek: kaydı müşteri açtıysa "Kapandı" durumuna onu müşteri geçirir.

## 3. Fiyat onayı — yapıldı
- **Kullanıcı kartı:**
  - "Yöneticisi" alanı (bir üst kişi).
  - Onay limiti için **TL, USD ve EUR olmak üzere üç alan**.
- **Fiyat onayı fonksiyonu:**
  - Alanlar: tutar + para birimi.
  - Onay durumu: Gerekmez / Bekliyor / Onaylandı / Reddedildi.
- **Para birimi kıyası:**
  - Tutar, kişinin aynı para birimindeki limitiyle kıyaslanır; çevirme gerekmez.
  - Bu üçü dışındaki para birimleri TCMB kuruyla TL'ye çevrilir ve TL limitiyle kıyaslanır.
- **Akış:**
  - Tutar limit içindeyse onay gerekmez.
  - Limit aşılırsa onay, yönetici zincirinde limiti yeten ilk kişiye gider (bildirim + mobil).
  - Onaylayanın limiti yetmezse onay bir üste çıkar.
  - Yönetim rolü limitsizdir.
- **Onaydan sonra:**
  - Tutar değişirse onay sıfırlanır.
  - Onay beklenirken (ya da red sonrası) kayıt seçilen durumlara geçemez. Hiçbiri seçilmezse "akışı kapatır" durumlarına geçemez.
- **Açık:** Yönetici izindeyken vekil olacak mı?

## 4. Kayıttan kayda aktarım (modülden modüle) — yapıldı
Bir modülün kaydı belli bir duruma gelince başka bir modülde, kaynaktaki verilerle beslenen yeni kayıt açılır.

Modül ayarlarında **"Aktarımlar"** bölümü bulunur. Her aktarımın tanımı:
- **Hedef modül:** örnek Servis → Teknik hizmet.
- **Tetikleyen durum:** kaynak bu duruma geçince aktarım başlar. Ayrıca kayıtta "… aktar" düğmesi de bulunur.
- **Alan eşleme:**
  - Aynı adlı alanlar kendiliğinden eşlenir; kalanlar elle seçilir.
  - Satırlı fonksiyonlar (malzeme, efor) istenirse taşınır.
- **Atama:** hedef kaydın kime açılacağı (aktaran kişi ya da seçilen kullanıcı, seçilen kişi alanına).

**Hatalı kayıt açılmaması için kullanıcıya sorulur:**
- Durum değişince hedef modülün formu, eşlenen verilerle dolu olarak ekrana gelir. Bu aşamada kayıt henüz oluşmamıştır.
- Hedef modülde zorunlu olup kaynakta karşılığı olmayan alanlar kırmızı çerçeveyle işaretlenir. Kullanıcı bunları doldurmadan kaydedemez.
- Kullanıcı kaydedince hedef kayıt açılır. İki kayıt birbirine bağlanır; her iki tarafta "Bağlı kayıtlar" görünür.
- Kullanıcı vazgeçerse kayıt açılmaz. Kaynaktaki durum değişikliği kalır ve aktarım sonra düğmeyle yapılabilir.

**Kurallar:**
- Bir kayıttan her aktarımla **tek** hedef kayıt açılır.
- Kaynak kayıt aktarımdan sonra **açık kalır**.
- Fatura ERP'de yapılmaz, **muhasebe programına** gider. Bu entegrasyon ayrıca konuşulacak.

## 5. Efor — yapıldı
Efor ("Zaman Takibi") bir fonksiyondur; herhangi bir modüle eklenir.
- **Düğmeler:** Kayıtta Başla / Mola / Devam / Bitir bulunur. Her basış, kişi ve saatle birlikte anında yazılır.
- **Toplamlar:** Kayıtta kişi bazında net çalışma ve mola toplamı görünür.
- **Tek açık iş:** Bir kişinin aynı anda tek açık işi olur. Başka bir işte "Başla"ya basınca önceki iş "durdu" olur.
- **Unutulan sayaç:** Üst çubukta açık sayaç görünür. Dünden kalan ya da 10 saati geçen sayaç kırmızı uyarı verir.
- **Mobil:** Düğmeler kayıtta en üstte çıkar. Ana ekranda "şu an çalıştığın iş" bandı vardır.
- **İzin:** İşin içinde tutulmaz. Kişinin genel durumudur (bütün gün izinli) ve ayrıca ele alınacak.
- **Malzeme:** Sarf, fire ve kullanım mevcut stok hareketiyle girilir.

## 6. Misafir girişi — yapıldı
- **Tanımlama:** Yönetici misafiri Kullanıcılar ekranına **"Misafir"** türüyle kaydeder. Misafir kullanıcı gibi değerlendirilir: yetki grubu, modül ve fonksiyon yetkileri normal kullanıcıdaki gibidir. Misafir yönetici olamaz.
- **Giriş:** Normal kullanıcı gibi **e-posta ve şifreyle** girer; giriş sistemi değişmez.
  - İlk şifre, diğer kullanıcılardaki gibi geçici şifre olarak e-postalanır ve ilk girişte değiştirilir.
  - Şifremi unuttum, kilit ve oturum kuralları aynıdır.
- **Zaman sınırı:**
  - Misafir kartında başlangıç ve bitiş tarihi, günler ve izinli saat aralığı bulunur (İstanbul saati; ör. hafta içi 08:00–18:00).
  - Süre dışında **yeni giriş yapılamaz; açık oturum kapanmaz**.
- **Firma:** Misafir kartında **Firma** alanı bulunur (rehberdeki firma).
- **Görünürlük** (misafir başına seçilir):
  - **Yalnız kendi kayıtları:** misafirin açtığı ya da kişi alanında adı geçen kayıtlar.
  - **Firmasının kayıtları:** bunlara ek olarak firma alanı misafirin firmasıyla eşleşen kayıtlar. Eşleşme, kayıttaki firma fonksiyonu ya da proje firması üzerinden bulunur.
  - Kapsam dışındaki kayıtlar sunucuda süzülür.
- **Lisans:** Misafirler **kullanıcı sayısına girer**.

## 7. Açık form bağlantısı — yapıldı
- Mevcut dış onay (QR) yapısı kullanılır. Ek olarak, **kayıt açmadan** uzun ve kalıcı bir bağlantı ve QR üretilir (`/onay.html#f=…`). Ayar: Modül ayarları → Açık form bağlantısı.
- Formu doldurmak yeni kayıt açar. Alanlar şablondaki `[[Alan]]` yazımıyla belirlenir ve aynı adlı fonksiyona yazılır.
- Doldurulmuş belge, modülde Şablon fonksiyonu varsa saklanır.
- Formu dolduran kişiye takip bağlantısı verilir (`#t=…`). E-posta yazdıysa bağlantı ona e-postayla da gider.
- Robot önlemleri: deneme sınırı, tuzak alanı ve en az 3 saniyelik doldurma süresi.
- Bağlantı yenilenebilir, kapatılabilir ya da silinebilir.

## 8. Ticket fonksiyonu (e-posta) — yapıldı
- **Ticket fonksiyonu**, modüle bağlı bir IMAP kutusunu kontrol eder. Okunmamış her iletiden kayıt açar.
- Konu ve gövde kayda kopyalanır. Gönderen, rehberdeki e-postasıyla firmaya bağlanır.
- Konuda kayıt kodu varsa (`[SRV-1001]`), ileti o kayda mesaj olarak eklenir.
- Kutu, modül açılınca en çok 2 dakikada bir kontrol edilir. "E-posta" düğmesiyle hemen de kontrol edilebilir.
- Kullanıcı isterse ticket'ı aktarımla başka formlara taşır.
- AI (özet, kategori, öncelik) sonra eklenecek.

## 9. Performans (adam/saat) — açık
Efor verisi biriktikten sonra panolara eklenir.

**Açık:** Ölçüt ne olacak? Seçenekler: planlanan süreye karşı gerçekleşen, kişiler arası kıyas ya da toplam saat.
