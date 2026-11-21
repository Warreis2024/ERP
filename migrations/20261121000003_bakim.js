// Veritabanı bakımı (21.11.2026 incelemesi):
//  • kayit_baglari(kaynak_id, aktarim) tekil: aynı kayıt aynı aktarımla iki kez aktarılamaz (yarış durumuna karşı)
//  • eksik indeksler: kişi/ekip ve tarih süzgeçleri, modül günlüğü, yabancı anahtarlar
//  • projeler.arsiv_tarihi: arşivlenme zamanı (3 yıl kuralı ve depoya süpürme için)
//  • PostgreSQL'de saat dilimsiz zaman sütunları timestamptz olur (değerler UTC kabul edilir)
const ZAMAN_SUTUNLARI = {
  ayarlar: ['guncelleme'],
  cihazlar: ['kod_son', 'olusturma', 'son_kullanim'],
  ciktilar: ['guncelleme'],
  degerler: ['guncelleme', 'olusturma', 'zaman'],
  dis_onaylar: ['guncelleme', 'olusturma', 'son_gecerlilik', 'yanit_zaman'],
  epostalar: ['zaman'],
  giris_kayitlari: ['zaman'],
  kartlar: ['guncelleme', 'olusturma'],
  kiosklar: ['guncelleme'],
  kullanicilar: ['guncelleme', 'kilit', 'olusturma', 'sifre_tarih', 'son_giris'],
  log: ['zaman'],
  notlar: ['olusturma'],
  panolar: ['guncelleme'],
  projeler: ['guncelleme', 'olusturma'],
  push_abonelikleri: ['olusturma'],
  sablonlar: ['guncelleme'],
};

const INDEKSLER = [
  ['degerler', ['fn_tip', 'kisi']],
  ['degerler', ['fn_tip', 'guncelleme']],
  ['log', ['modul_id', 'id']],
  ['kartlar', ['durum_id']],
  ['projeler', ['durum_id']],
  ['kullanicilar', ['grup_id']],
  ['proje_kisileri', ['kullanici_id']],
  ['rehber_kisiler', ['firma_id']],
];

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const pg = knex.client.config.client === 'pg';
  await knex.schema.alterTable('projeler', (t) => { t.timestamp('arsiv_tarihi'); });
  // arşivdeki projelere yaklaşık tarih: son güncelleme
  await knex('projeler').where({ arsiv: true }).whereNull('arsiv_tarihi').update({ arsiv_tarihi: knex.ref('guncelleme') });

  if (pg) {
    for (const [tb, sut] of Object.entries(ZAMAN_SUTUNLARI)) {
      const var_ = await knex('information_schema.columns').where({ table_schema: 'public', table_name: tb, data_type: 'timestamp without time zone' }).whereIn('column_name', sut).pluck('column_name');
      if (!var_.length) continue;
      const parca = var_.map((c) => knex.raw('alter column ?? type timestamptz using ?? at time zone \'UTC\'', [c, c]).toQuery());
      await knex.raw(`alter table public.?? ${parca.join(', ')}`, [tb]);
    }
  }

  for (const [tb, k] of INDEKSLER) {
    if (await knex.schema.hasTable(tb)) await knex.schema.alterTable(tb, (t) => { t.index(k); });
  }
  await knex.schema.alterTable('kayit_baglari', (t) => { t.unique(['kaynak_id', 'aktarim']); });
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('kayit_baglari', (t) => { t.dropUnique(['kaynak_id', 'aktarim']); });
  for (const [tb, k] of INDEKSLER) {
    if (await knex.schema.hasTable(tb)) await knex.schema.alterTable(tb, (t) => { t.dropIndex(k); });
  }
  await knex.schema.alterTable('projeler', (t) => { t.dropColumn('arsiv_tarihi'); });
  // timestamptz → timestamp dönüşümü geri alınmaz (veri kaybı yok, gereksiz)
}
