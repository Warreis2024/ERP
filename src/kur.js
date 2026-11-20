// TCMB döviz kurları (1 birim = x TL, döviz satış). Yalnız TL / USD / EUR dışındaki para birimleri için gerekir.
// Sonuç 6 saat bellekte tutulur; alınamazsa boş döner (fiyat onayı o zaman güvenli tarafta kalıp onaya gönderir).
let onbellek = { zaman: 0, kurlar: {} };

export function tcmbCoz(xml) {
  const kurlar = {};
  const re = /<Currency\b[^>]*CurrencyCode="([A-Z]{3})"[^>]*>([\s\S]*?)<\/Currency>/g;
  let m;
  while ((m = re.exec(xml))) {
    const ic = m[2];
    const birim = Number((ic.match(/<Unit>(\d+)<\/Unit>/) || [])[1] || 1);
    const satis = Number(((ic.match(/<ForexSelling>([\d.]+)<\/ForexSelling>/) || ic.match(/<BanknoteSelling>([\d.]+)<\/BanknoteSelling>/) || [])[1]) || 0);
    if (satis > 0) kurlar[m[1]] = satis / (birim || 1);
  }
  return kurlar;
}

export async function kurlar() {
  if (Date.now() - onbellek.zaman < 6 * 3600_000 && Object.keys(onbellek.kurlar).length) return onbellek.kurlar;
  try {
    const r = await fetch('https://www.tcmb.gov.tr/kurlar/today.xml', { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error('TCMB ' + r.status);
    const k = tcmbCoz(await r.text());
    if (Object.keys(k).length) onbellek = { zaman: Date.now(), kurlar: k };
  } catch (e) { console.error('kur:', e.message); }
  return onbellek.kurlar;
}
