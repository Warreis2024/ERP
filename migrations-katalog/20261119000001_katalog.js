// Merkezi katalog veritabanı (yalnız MOD=coklu). Firma → veritabanı eşlemesi.
// Bağlantı adresi (şifre) burada tutulmaz; db_env, adresin bulunduğu ortam değişkeninin adıdır.
//   KATALOG için: npx knex --knexfile knexfile-katalog.js migrate:latest

/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.createTable('firmalar', (t) => {
    t.string('sub', 40).primary();          // yontem → yontem.iq-sense.com.tr
    t.string('ad', 150).notNullable();
    t.string('db_client', 10).notNullable().defaultTo('mssql');
    t.string('db_env', 60).notNullable();    // ör. DB_YONTEM
    t.boolean('aktif').notNullable().defaultTo(true);
    t.datetime('olusturma', { useTz: false });
  });
}
/** @param {import('knex').Knex} knex */
export async function down(knex) { await knex.schema.dropTableIfExists('firmalar'); }
