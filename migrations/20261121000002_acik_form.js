// Açık form bağlantısı (kayıt açmadan, kalıcı QR / bağlantı ile dışarıdan yeni kayıt) ve
// formu dolduranın takip bağlantısı. Anahtarların yalnız özeti (sha256) aranır; yöneticinin yeniden
// görebilmesi için anahtar ayrıca şifreli kasada (AES-GCM) tutulur.
const ID = 40;

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('acik_formlar', (t) => {
    t.string('id', ID).primary();
    t.string('modul_id', ID).notNullable();
    t.string('ad', 150).notNullable();
    t.string('sablon_id', ID).notNullable();
    t.string('proje_id', ID).notNullable();
    t.string('durum_id', ID);
    t.text('eslesme');                       // {"[[Alan]] adı": fnUid}
    t.string('anahtar_ozet', 64).unique();
    t.text('anahtar_sifreli');
    t.boolean('aktif').notNullable().defaultTo(true);
    t.integer('sayac').notNullable().defaultTo(0);
    t.string('olusturan', ID);
    t.timestamp('olusturma').notNullable().defaultTo(knex.fn.now());
    t.string('guncelleyen', ID);
    t.timestamp('guncelleme');
  });
  await knex.schema.createTable('form_takipler', (t) => {
    t.string('id', ID).primary();
    t.string('form_id', ID).notNullable();
    t.string('kart_id', ID).notNullable();
    t.string('anahtar_ozet', 64).unique();
    t.string('eposta', 254);
    t.string('ad', 150);
    t.string('ip', 64);
    t.timestamp('olusturma').notNullable().defaultTo(knex.fn.now());
    t.index(['kart_id']);
  });
  if (knex.client.config.client === 'pg') {
    for (const tb of ['acik_formlar', 'form_takipler']) {
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
}

/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.dropTableIfExists('form_takipler');
  await knex.schema.dropTableIfExists('acik_formlar');
}
