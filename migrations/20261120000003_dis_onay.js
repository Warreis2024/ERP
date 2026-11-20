// Dış onay (QR): şablonun şifresiz, süreli bağlantıyla müşteriye açılması ve yanıtı.
// Bağlantı anahtarının yalnız SHA-256 özeti aranır; yeniden basmak için anahtar kasa şifresiyle (AES-256-GCM) saklanır.

const ID = 40;

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const dt = (t, ad) => t.datetime(ad, { useTz: false });
  await knex.schema.createTable('dis_onaylar', (t) => {
    t.string('id', ID).primary();
    t.string('anahtar_ozet', 64).notNullable().unique();
    t.text('anahtar_sifreli').notNullable();
    t.string('kart_id', ID).notNullable().references('id').inTable('kartlar');
    t.string('proje_id', ID).notNullable();
    t.string('modul_id', ID).notNullable();
    t.string('fn_uid', ID).notNullable();
    t.string('baslik', 200);
    t.text('belge').notNullable();          // müşteriye gösterilen anlık görüntü (HTML)
    t.text('alanlar');                      // JSON: [{ad, tip}] — müşterinin dolduracağı alanlar
    t.boolean('onay_istenir').notNullable().defaultTo(true);
    t.boolean('not_istenir').notNullable().defaultTo(true);
    dt(t, 'son_gecerlilik');
    t.string('durum', 20).notNullable().defaultTo('bekliyor'); // bekliyor | yanitlandi | iptal
    t.text('yanit');                        // JSON: {alanlar, imzalar, karar, notu}
    dt(t, 'yanit_zaman');
    t.string('yanit_ip', 64);
    t.string('yanit_tarayici', 250);
    t.string('olusturan', ID);
    dt(t, 'olusturma');
    t.string('guncelleyen', ID);
    dt(t, 'guncelleme');
    t.index(['kart_id']);
  });
  if (knex.client.config.client === 'pg') {
    await knex.raw('alter table public.dis_onaylar enable row level security');
    const roller = await knex.raw("select rolname from pg_roles where rolname in ('anon','authenticated')");
    if (roller.rows.length === 2) await knex.raw('revoke all on public.dis_onaylar from anon, authenticated');
    // Uygulama ayrı bir rolle (erp_app) bağlanıyorsa diğer tablolardaki gibi yetki ve politika verilir
    const app = await knex.raw("select 1 from pg_roles where rolname = 'erp_app'");
    if (app.rows.length) {
      await knex.raw('grant select, insert, update, delete on public.dis_onaylar to erp_app');
      await knex.raw('create policy erp_app_tam on public.dis_onaylar for all to erp_app using (true) with check (true)');
    }
  }
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('dis_onaylar');
}
