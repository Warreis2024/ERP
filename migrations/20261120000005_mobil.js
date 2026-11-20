// Mobil uygulama: eşlenmiş cihazlar (şifresiz, iptal edilebilir), web push abonelikleri, kişisel notlar.
const ID = 40;

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  const dt = (t, ad) => t.datetime(ad, { useTz: false });
  await knex.schema.createTable('cihazlar', (t) => {
    t.string('id', ID).primary();
    t.string('kullanici_id', ID).notNullable().references('id').inTable('kullanicilar');
    t.string('ad', 120);
    t.string('kod_ozet', 64).unique();          // tek kullanımlık eşleme kodunun SHA-256 özeti
    dt(t, 'kod_son');                            // eşleme kodunun son geçerlilik zamanı
    t.string('durum', 20).notNullable().defaultTo('bekliyor'); // bekliyor | aktif | iptal
    t.string('tarayici', 250);
    dt(t, 'son_kullanim');
    dt(t, 'olusturma');
    t.index(['kullanici_id']);
  });
  await knex.schema.createTable('push_abonelikleri', (t) => {
    t.string('id', ID).primary();
    t.string('kullanici_id', ID).notNullable().references('id').inTable('kullanicilar');
    t.string('cihaz_id', ID);
    t.string('endpoint', 1000).notNullable().unique();
    t.string('p256dh', 200).notNullable();
    t.string('auth', 100).notNullable();
    dt(t, 'olusturma');
    t.index(['kullanici_id']);
  });
  await knex.schema.createTable('notlar', (t) => {
    t.string('id', ID).primary();
    t.string('kullanici_id', ID).notNullable().references('id').inTable('kullanicilar');
    t.text('metin');
    t.text('ekler');                             // JSON: [{ad, url(data:)}]
    dt(t, 'olusturma');
    t.index(['kullanici_id']);
  });
  if (knex.client.config.client === 'pg') {
    for (const tb of ['cihazlar', 'push_abonelikleri', 'notlar']) {
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
  for (const tb of ['notlar', 'push_abonelikleri', 'cihazlar']) await knex.schema.dropTableIfExists(tb);
}
