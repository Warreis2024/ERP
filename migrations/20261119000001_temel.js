// Yöntem ERP — temel şema (firma veritabanı).
// Taşınabilirlik kuralları (PostgreSQL ↔ MS SQL ↔ ileride Progress):
//  • Kimlikler uygulamada üretilen metindir (varchar 40); veritabanına özgü UUID tipi kullanılmaz.
//  • JSON alanları metin (text → MS SQL'de nvarchar(max)) olarak tutulur; JSON operatörü kullanılmaz.
//  • Tarih-saat UTC tutulur (datetime, saat dilimsiz). Tarih alanları date.
//  • SQL'de ayrılmış sözcükler sütun adı yapılmaz (ör. "not" → notu).
//  • Kısmi / filtreli indeks, dizi tipi, veritabanına özgü fonksiyon yok.

const ID = 40;

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const dt = (t, ad) => t.datetime(ad, { useTz: false });
  const denetim = (t) => {
    t.string('olusturan', ID); dt(t, 'olusturma');
    t.string('guncelleyen', ID); dt(t, 'guncelleme');
  };

  // ---------- firma ayarları (anahtar → JSON) ----------
  await knex.schema.createTable('ayarlar', (t) => {
    t.string('anahtar', 60).primary();
    t.text('deger');
    dt(t, 'guncelleme');
  });

  // ---------- kullanıcılar ve yetki ----------
  await knex.schema.createTable('yetki_gruplari', (t) => {
    t.string('id', ID).primary();
    t.string('ad', 100).notNullable();
    t.integer('sira').defaultTo(0);
  });
  await knex.schema.createTable('departmanlar', (t) => {
    t.string('ad', 100).primary();
    t.integer('sira').defaultTo(0);
  });
  await knex.schema.createTable('kullanicilar', (t) => {
    t.string('id', ID).primary();
    t.string('ad', 150).notNullable();
    t.string('unvan', 150);
    t.string('eposta', 254).notNullable().unique();
    t.string('tel', 40);
    t.string('rol', 20).notNullable().defaultTo('personel'); // yonetici | personel
    t.string('grup_id', ID).references('id').inTable('yetki_gruplari');
    t.string('departman', 100);
    t.boolean('aktif').notNullable().defaultTo(true);
    t.boolean('sistem').notNullable().defaultTo(false);
    t.text('foto');                       // küçük data URL (96 px); büyük dosya depoda
    t.string('sifre_ozet', 255);          // argon2id
    t.boolean('sifre_degismeli').notNullable().defaultTo(false);
    dt(t, 'sifre_tarih');
    t.integer('oturum_surumu').notNullable().defaultTo(1); // artınca açık oturumlar düşer
    t.integer('hatali').notNullable().defaultTo(0);
    dt(t, 'kilit');
    dt(t, 'son_giris');
    t.text('tercih');                     // JSON: tema, açılış, görünüm (kanban/liste), pano gizleme
    t.text('eposta_hesap');               // JSON: tür, adres, sunucu (şifre/token burada tutulmaz)
    denetim(t);
  });
  await knex.schema.createTable('kullanici_yetki', (t) => {
    t.string('kullanici_id', ID).notNullable().references('id').inTable('kullanicilar').onDelete('CASCADE');
    t.string('modul_id', ID).notNullable();
    t.string('yetki', 10).notNullable().defaultTo('yok'); // yok | oku | yaz
    t.boolean('onay').notNullable().defaultTo(false);
    t.boolean('disa').notNullable().defaultTo(false);
    t.primary(['kullanici_id', 'modul_id']);
  });
  await knex.schema.createTable('giris_kayitlari', (t) => {
    t.increments('id').primary();
    t.string('kullanici_id', ID).index();
    t.string('eposta', 254);
    t.boolean('basarili').notNullable();
    t.string('ip', 64);
    t.string('tarayici', 200);
    dt(t, 'zaman');
  });

  // ---------- modül tanımı: durumlar, fonksiyonlar, opsiyonlar ----------
  await knex.schema.createTable('moduller', (t) => {
    t.string('id', ID).primary();
    t.string('ad', 100).notNullable();
    t.string('renk', 20);
    t.string('ikon', 30);
    t.string('onek', 10).notNullable();
    t.string('tur', 10).notNullable().defaultTo('kart'); // proje | kart
    t.boolean('acik').notNullable().defaultTo(true);
    t.integer('sira').defaultTo(0);
    t.text('sistem'); // JSON: sistem alanlarının kanban/liste varsayılanı
  });
  await knex.schema.createTable('durumlar', (t) => {
    t.string('id', ID).primary();
    t.string('modul_id', ID).notNullable().references('id').inTable('moduller').onDelete('CASCADE');
    t.string('ad', 100).notNullable();
    t.string('renk', 20);
    t.integer('sira').notNullable().defaultTo(0);
    t.boolean('kapat').notNullable().defaultTo(false);
    t.index(['modul_id', 'sira']);
  });
  await knex.schema.createTable('fonksiyonlar', (t) => {
    t.string('uid', ID).primary();
    t.string('modul_id', ID).notNullable().references('id').inTable('moduller').onDelete('CASCADE');
    t.string('tip', 20).notNullable();
    t.string('ad', 100).notNullable();
    t.boolean('zorunlu').notNullable().defaultTo(false);
    t.string('grup', 60);            // opsiyon grubu (tür, aciliyet, kontrol listesi…)
    t.string('tarih_vars', 20);
    t.string('sekme', 60);
    t.boolean('kanban').notNullable().defaultTo(false);
    t.boolean('liste').notNullable().defaultTo(true);
    t.integer('sira').notNullable().defaultTo(0);
    t.text('yetki');                 // JSON: { grup_id: 'duzenle' | 'gor' | 'gizli' }
    t.index(['modul_id', 'sira']);
  });
  await knex.schema.createTable('opsiyonlar', (t) => {
    t.string('id', ID).primary();
    t.string('grup', 60).notNullable().index();
    t.string('ad', 150).notNullable();
    t.boolean('varsayilan').notNullable().defaultTo(false);
    t.string('tur', 10).notNullable().defaultTo('select'); // select | radio | check
    t.integer('sira').notNullable().defaultTo(0);
  });
  await knex.schema.createTable('sayaclar', (t) => {  // kayıt kodu (PRJ-1001) için
    t.string('anahtar', ID).primary();
    t.integer('son').notNullable().defaultTo(1000);
  });

  // ---------- projeler, kayıtlar, değerler ----------
  await knex.schema.createTable('projeler', (t) => {
    t.string('id', ID).primary();
    t.string('kod', 30).notNullable().unique();
    t.string('ad', 250).notNullable();
    t.string('durum_id', ID).references('id').inTable('durumlar');
    t.string('kategori', 100);
    t.boolean('arsiv').notNullable().defaultTo(false);
    t.boolean('silindi').notNullable().defaultTo(false);
    denetim(t);
    t.index(['silindi', 'arsiv']);
  });
  await knex.schema.createTable('proje_kisileri', (t) => {
    t.string('proje_id', ID).notNullable().references('id').inTable('projeler').onDelete('CASCADE');
    t.string('kullanici_id', ID).notNullable().references('id').inTable('kullanicilar');
    t.string('rol', 10).notNullable(); // yonetici | ekip
    t.primary(['proje_id', 'kullanici_id', 'rol']);
  });
  await knex.schema.createTable('kartlar', (t) => {
    t.string('id', ID).primary();
    t.string('kod', 30).notNullable().unique();
    t.string('modul_id', ID).notNullable().references('id').inTable('moduller');
    t.string('proje_id', ID).notNullable().references('id').inTable('projeler');
    t.string('durum_id', ID).references('id').inTable('durumlar');
    t.date('tarih');
    t.boolean('silindi').notNullable().defaultTo(false);
    denetim(t);
    t.index(['modul_id', 'silindi']);
    t.index(['proje_id']);
  });
  // Bütün fonksiyon değerleri tek tabloda (README: ortak tablo).
  await knex.schema.createTable('degerler', (t) => {
    t.string('id', ID).primary();
    t.string('modul_id', ID).notNullable();
    t.string('proje_id', ID).notNullable().references('id').inTable('projeler');
    t.string('kart_id', ID).references('id').inTable('kartlar');
    t.string('fn_uid', ID).notNullable();
    t.string('fn_tip', 20).notNullable();
    t.string('ust_id', ID);
    t.integer('sira').notNullable().defaultTo(0);
    t.text('metin');
    t.date('tarih');
    t.date('vade');
    dt(t, 'zaman');
    t.string('kisi', 150);          // kullanıcı id ya da rehberdeki serbest ad
    t.string('kisi_id', ID);
    t.string('tur', 150);
    t.string('firma', 250);
    t.string('hareket', 20);
    t.string('odeme', 60);
    t.decimal('adet', 18, 4);
    t.decimal('tutar', 18, 2);
    t.string('para', 3);
    t.text('url');                  // bağlantı ya da (depo adaptörü gelene kadar) küçük dosyanın data URL'i
    t.string('dosya', 300);
    t.bigInteger('boyut');
    t.string('depo', 60);           // dosya deposu (yerel/nas/gdrive…) ya da stok deposu id
    t.string('hedef', ID);
    t.string('malzeme', 250);
    t.string('birim', 30);
    t.string('rev', 10);
    t.string('onem', 10);
    t.string('onay', 10);
    t.string('yukleyen', ID);
    t.boolean('yildiz').notNullable().defaultTo(false);
    t.string('renk', 20);
    t.text('notu');
    t.string('yer', 250);
    t.string('il', 60);
    t.string('ilce', 60);
    t.string('ulke', 60);
    t.text('ek');                   // JSON: okuyan, ekler, slot ve tipe özgü diğer alanlar
    denetim(t);
    t.index(['kart_id']);
    t.index(['proje_id', 'kart_id']);
    t.index(['fn_tip', 'modul_id']);
  });
  await knex.schema.createTable('log', (t) => {
    t.increments('id').primary();
    t.string('proje_id', ID).index();
    t.string('modul_id', ID);
    t.string('kart_id', ID).index();
    t.string('tip', 20).notNullable();  // yeni | durum | alan | sil | eposta
    t.string('kisi_id', ID);
    t.string('kisi_ad', 150);
    dt(t, 'zaman');
    t.string('alan', 150);
    t.text('eski');
    t.text('yeni');
    t.text('metin');
  });

  // ---------- rehber, depo/stok ----------
  await knex.schema.createTable('rehber_firmalar', (t) => {
    t.string('id', ID).primary();
    t.string('ad', 250).notNullable();
    t.string('vergi_no', 20); t.string('vd', 100);
    t.string('tel', 40); t.string('eposta', 254);
    t.text('adres'); t.text('notu');
  });
  await knex.schema.createTable('rehber_kisiler', (t) => {
    t.string('id', ID).primary();
    t.string('ad', 150).notNullable();
    t.string('firma_id', ID).references('id').inTable('rehber_firmalar');
    t.string('unvan', 100); t.string('tel', 40); t.string('eposta', 254);
  });
  await knex.schema.createTable('depolar', (t) => {
    t.string('id', ID).primary();
    t.string('ad', 100).notNullable();
    t.integer('sira').defaultTo(0);
  });
  await knex.schema.createTable('malzemeler', (t) => {
    t.string('id', ID).primary();
    t.string('kod', 60);
    t.string('ad', 250).notNullable();
    t.string('birim', 30);
    t.decimal('kritik', 18, 4);
  });

  // ---------- tanımlar: şablon, pano, kiosk, çıktı ----------
  for (const ad of ['sablonlar', 'panolar', 'kiosklar', 'ciktilar']) {
    await knex.schema.createTable(ad, (t) => {
      t.string('id', ID).primary();
      t.string('ad', 150).notNullable();
      t.integer('sira').defaultTo(0);
      t.text('tanim'); // JSON
      dt(t, 'guncelleme');
    });
  }

  // ---------- e-posta kayıtları ----------
  await knex.schema.createTable('epostalar', (t) => {
    t.string('id', ID).primary();
    t.string('proje_id', ID); t.string('kart_id', ID); t.string('modul_id', ID);
    t.string('kimden_id', ID); t.string('kimden_adres', 254); t.string('kanal', 20);
    t.text('kime'); t.string('konu', 500); t.text('govde');
    dt(t, 'zaman');
  });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  for (const t of ['epostalar', 'ciktilar', 'kiosklar', 'panolar', 'sablonlar', 'malzemeler', 'depolar',
    'rehber_kisiler', 'rehber_firmalar', 'log', 'degerler', 'kartlar', 'proje_kisileri', 'projeler', 'sayaclar',
    'opsiyonlar', 'fonksiyonlar', 'durumlar', 'moduller', 'giris_kayitlari', 'kullanici_yetki', 'kullanicilar',
    'departmanlar', 'yetki_gruplari', 'ayarlar']) {
    await knex.schema.dropTableIfExists(t);
  }
}
