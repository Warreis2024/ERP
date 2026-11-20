// Kural katmanı, aktarım ve misafir kullanıcı:
//  • fonksiyonlar.ayar (JSON): degistir (kim değiştirebilir), engel (fiyat onayı beklerken geçilemeyen durumlar) …
//  • durumlar.gecis: bu duruma kim geçirebilir ('' herkes | 'acan' | 'acanYonetim')
//  • moduller.aktarimlar (JSON): kayıttan kayda aktarım tanımları
//  • kullanicilar: üst yönetici, onay limitleri (TL/USD/EUR), misafir alanları
//  • kayit_baglari: aktarımla bağlanan kayıtlar
const ID = 40;

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('fonksiyonlar', (t) => { t.text('ayar'); });
  await knex.schema.alterTable('durumlar', (t) => { t.string('gecis', 12); });
  await knex.schema.alterTable('moduller', (t) => { t.text('aktarimlar'); });
  await knex.schema.alterTable('kullanicilar', (t) => {
    t.string('ust_id', ID);
    t.text('onay_limit');                         // {"TL":50000,"USD":2000,"EUR":1500}
    t.string('tur', 12).notNullable().defaultTo('kullanici'); // 'kullanici' | 'misafir'
    t.string('firma', 250);                       // misafirin firması (rehber)
    t.date('gecerli_bas');
    t.date('gecerli_bit');
    t.string('saat_bas', 5);                      // SS:DD
    t.string('saat_bit', 5);
    t.string('gunler', 7);                        // '12345' = Pzt–Cum
    t.string('gorunum', 10);                      // misafir: 'kendi' | 'firma'
  });
  await knex.schema.createTable('kayit_baglari', (t) => {
    t.string('id', ID).primary();
    t.string('kaynak_tur', 10).notNullable();     // 'proje' | 'kart'
    t.string('kaynak_id', ID).notNullable();
    t.string('hedef_tur', 10).notNullable();
    t.string('hedef_id', ID).notNullable();
    t.string('aktarim', ID);
    t.string('olusturan', ID);
    t.timestamp('olusturma').notNullable().defaultTo(knex.fn.now());
    t.index(['kaynak_id']); t.index(['hedef_id']);
  });
  if (knex.client.config.client === 'pg') {
    const tb = 'kayit_baglari';
    await knex.raw('alter table public.?? enable row level security', [tb]);
    const roller = await knex.raw("select rolname from pg_roles where rolname in ('anon','authenticated')");
    if (roller.rows.length === 2) await knex.raw('revoke all on public.?? from anon, authenticated', [tb]);
    const app = await knex.raw("select 1 from pg_roles where rolname = 'erp_app'");
    if (app.rows.length) {
      await knex.raw('grant select, insert, update, delete on public.?? to erp_app', [tb]);
      await knex.raw('create policy erp_app_tam on public.?? for all to erp_app using (true) with check (true)', [tb]);
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('kayit_baglari');
  await knex.schema.alterTable('kullanicilar', (t) => {
    t.dropColumns('ust_id', 'onay_limit', 'tur', 'firma', 'gecerli_bas', 'gecerli_bit', 'saat_bas', 'saat_bit', 'gunler', 'gorunum');
  });
  await knex.schema.alterTable('moduller', (t) => { t.dropColumn('aktarimlar'); });
  await knex.schema.alterTable('durumlar', (t) => { t.dropColumn('gecis'); });
  await knex.schema.alterTable('fonksiyonlar', (t) => { t.dropColumn('ayar'); });
}
