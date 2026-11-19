# Kurulum

Üç ortam vardır. Kod aynıdır; yalnız `.env` değişir.

| Ortam | Amaç | Veritabanı | Firma |
|---|---|---|---|
| Yerel | Geliştirme | PostgreSQL ya da MS SQL | tek |
| Vercel + Supabase | 1–2 haftalık kullanıcı testi | PostgreSQL (Supabase) | tek |
| Windows Server + IIS | Canlı | MS SQL, firma başına ayrı veritabanı | çoklu |

Gereken: Node.js 20 ya da üstü (önerilen 22 LTS).

---

## 1. Yerel geliştirme

```bash
git clone https://github.com/Warreis2024/ERP.git
cd ERP
npm install
cp .env.example .env        # Windows: copy .env.example .env
```

`.env` içinde en az şunları doldurun:
- `DATABASE_URL`;
- `DB_CLIENT`;
- `OTURUM_GIZLI` (rastgele, en az 32 karakter):
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```

```bash
npm run migrate      # tabloları kurar
npm run seed         # şablondaki tanımlar + örnek veri (VAR OLAN VERİYİ SİLER)
npm run dev          # http://localhost:3000
npm test             # iş kuralı testleri
```

Yerelde `GUVENLI_CEREZ=false` yapın; yoksa tarayıcı http üzerinde oturum çerezini kabul etmez.

Giriş bilgileri:
- **Yönetici:** `admin@iq-sense.com.tr` / `admin123`. İlk girişte şifre değiştirmek zorunludur.
- **Örnek kullanıcılar:** `ayse@`, `mehmet@`, `zeynep@`, `can@`, `burak@yontem.com.tr` / `Deneme123` (`ORNEK_SIFRE` ile değişir).
- **Yalnız tanımlarla, örneksiz kurmak için:** `ORNEK=0 npm run seed`.

---

## 2. Test: Vercel + Supabase (tek firma)

> **Durum (19.11.2026):** Supabase projesi `yontem-erp-test` (Frankfurt, `iddmthvuzcbgvnyxppgs`) açıldı.
> - Şema kuruldu; tablolar `knex_migrations`'a işlendi, bu yüzden `npm run migrate` tekrar kurmaz.
> - Örnek veri yüklendi.
> - Bütün tablolarda RLS açık; anon/authenticated rollerinin erişimi kaldırıldı.
>
> Aşağıdaki Supabase adımlarından yalnız veritabanı şifresini almak ve Storage bucket açmak kaldı.


### Supabase
1. supabase.com'da yeni proje açın. Bölge olarak Frankfurt (eu-central-1) önerilir.
2. **Project Settings → Database → Connection string** bölümüne gidin:
   - **Transaction pooler** adresini (port 6543) Vercel için `DATABASE_URL` olarak alın.
   - Migration için **Session / direct** adresini (port 5432) kullanın.
3. **Storage → New bucket:** `erp-dosyalar` adıyla, **Public kapalı** açın. Dosya adaptörü sonraki adımda kullanılacak.
4. **Project Settings → API:** `service_role` anahtarını yalnız Vercel ortam değişkenine koyun; tarayıcıya ya da depoya asla girmez.

Tabloları kendi bilgisayarınızdan kurun: `.env`'de `DATABASE_URL` doğrudan bağlantı (5432), `DB_CLIENT=pg` olsun.

```bash
npm run migrate
npm run seed
```

### Vercel
1. vercel.com → **Add New → Project** → GitHub'daki `Warreis2024/ERP` deposunu seçin. Framework: **Other**.
2. **Environment Variables:**

| Ad | Değer |
|---|---|
| `MOD` | `tek` |
| `FIRMA_SUB` | `yontem` |
| `FIRMA_AD` | `Yöntem Teknoloji` |
| `DB_CLIENT` | `pg` |
| `DATABASE_URL` | Supabase **pooler** adresi (6543) |
| `DB_HAVUZ_MAX` | `3` |
| `OTURUM_GIZLI` | rastgele 48+ karakter |
| `GUVENLI_CEREZ` | `true` |
| `DEPO` | `supabase` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_BUCKET` | Supabase'den |

3. **Deploy.** Açılan adreste:
   - `/` sayfası API denetim ekranıdır; giriş, meta, projeler ve kayıtlar buradan denenir.
   - `/api/saglik` adresi `{ ok: true }` dönmelidir.
4. Her `git push` otomatik yeniden yayınlanır.

---

## 3. Canlı: Windows Server + IIS + MS SQL (çoklu firma)

### 3.1 MS SQL
- Her firma için ayrı veritabanı açılır: `yerp_yontem`, `yerp_alfa`… Ayrıca merkezi bir `yerp_katalog` veritabanı olur.
- Uygulama için ayrı bir SQL kullanıcısı açılır (`erp`). Bu kullanıcı yalnız bu veritabanlarında `db_datareader`, `db_datawriter` ve migration sırasında `db_ddladmin` yetkisi alır; `sa` kullanılmaz.
- Bağlantı adresi biçimi:
  ```
  mssql://erp:SIFRE@localhost:1433/yerp_yontem?encrypt=true&trustServerCertificate=true
  ```
  SQL Express için sona `&instanceName=SQLEXPRESS` eklenir.

Her firma veritabanı için:

```powershell
$env:DB_CLIENT="mssql"; $env:DATABASE_URL=$env:DB_YONTEM; npm run migrate
$env:ORNEK="0"; npm run seed      # tanımlar + yönetici, örnek veri yok
```

Katalog için:

```powershell
npx knex --knexfile knexfile-katalog.js migrate:latest
```

Sonra katalogdaki `firmalar` tablosuna her firma için bir satır eklenir:

```sql
INSERT INTO firmalar (sub, ad, db_client, db_env, aktif) VALUES ('yontem', N'Yöntem Teknoloji', 'mssql', 'DB_YONTEM', 1);
```

`db_env`, bağlantı adresinin bulunduğu ortam değişkeninin adıdır. Şifreler veritabanında değil, sunucunun `.env` dosyasındadır.

### 3.2 Node uygulaması (Windows servisi)

Uygulamayı `C:\erp` klasörüne koyun ve `npm ci --omit=dev` çalıştırın. `.env` dosyasında şunlar olsun:

```
MOD=coklu
ANA_ALAN=iq-sense.com.tr
KATALOG_DB_CLIENT=mssql
KATALOG_DATABASE_URL=mssql://erp:...@localhost:1433/yerp_katalog?trustServerCertificate=true
DB_YONTEM=mssql://erp:...@localhost:1433/yerp_yontem?trustServerCertificate=true
OTURUM_GIZLI=...
GUVENLI_CEREZ=true
DEPO=disk
DEPO_KLASOR=D:\erp-dosyalar
PORT=3000
```

Uygulamayı servis olarak kurun. NSSM ya da benzeri bir servis sarmalayıcı kullanılabilir:

```powershell
nssm install YontemERP "C:\Program Files\nodejs\node.exe" "C:\erp\server.js"
nssm set YontemERP AppDirectory C:\erp
nssm set YontemERP AppEnvironmentExtra NODE_ENV=production
nssm start YontemERP
```

Node yalnız `127.0.0.1:3000`'i dinler; dışarıya IIS açılır. Güvenlik duvarında 3000 kapalı kalmalıdır.

### 3.3 IIS
1. **URL Rewrite** ve **Application Request Routing (ARR)** modüllerini kurun. ARR → Server Proxy Settings → **Enable proxy** açılır.
2. **Tek site** açılır. Fiziksel yol: `C:\erp` (içindeki `web.config` kullanılır).
3. **Bağlama:**
   - https, host adı `*.iq-sense.com.tr` (IIS 10 joker host adını destekler);
   - **joker SSL sertifikası** `*.iq-sense.com.tr`.
4. DNS'te `*.iq-sense.com.tr` kaydı sunucuya yönlendirilir. Yeni firma için IIS'e dokunmak gerekmez; katalog satırı ve veritabanı yeterlidir.
5. `web.config` iki sunucu değişkeni yazar: `HTTP_X_FORWARDED_PROTO` ve `HTTP_X_FORWARDED_HOST`. Bunlara izin vermek için **URL Rewrite → View Server Variables** bölümünden ikisini de ekleyin.

### 3.4 Yedekleme
- MS SQL için tam ve günlük (log) yedek planı kurulur. README genel kuralı gereği silinen kayıt arayüzden geri alınmaz; geri dönüş yedekten yapılır.
- `DEPO_KLASOR` ve NAS klasörleri de aynı yedek planına girer.

---

## Güvenlik özeti
- Şifreler argon2id ile özetlenir. Paket kurulamazsa scrypt yedeği devreye girer.
- 5 hatalı denemede kullanıcı 5 dakika kilitlenir. Giriş denemeleri `giris_kayitlari` tablosunda tutulur.
- **Oturum:** İmzalı belirteç `HttpOnly`, `Secure` ve `SameSite=Lax` çerezde taşınır. Şifre değişince, kullanıcı pasife alınınca ya da rolü değişince açık oturumlar düşer.
- **CSRF:** Durum değiştiren her istek `X-CSRF-Token` başlığı ister; kaynak (Origin) da denetlenir.
- **Yetki:** Her istekte sunucuda denetlenir.
  - Gizli fonksiyonlar istemciye hiç gönderilmez.
  - "Gör" ve "Görme" alanları istemci ne gönderirse göndersin değişmez.
  - Kapanış onayı ve silme kuralı sunucudadır.
- Hata mesajları iç ayrıntı (SQL, yığın) içermez. Güvenlik başlıkları helmet ile verilir.
- Arayüz şu an tek dosya olduğu için CSP'de satır içi betiğe izin verilmiş durumda; arayüz modüllere bölününce kaldırılacak.
