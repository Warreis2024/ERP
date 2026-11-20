// Kontrol listesi fonksiyonu birden çok madde listesi taşıyabilir ("a|b|c"): grup sütunu genişletilir.
/** @param {import('knex').Knex} knex */
export async function up(knex) {
  await knex.schema.alterTable('fonksiyonlar', (t) => { t.string('grup', 250).alter(); });
}
/** @param {import('knex').Knex} knex */
export async function down(knex) {
  await knex.schema.alterTable('fonksiyonlar', (t) => { t.string('grup', 60).alter(); });
}
