import { logYaz, adCozucu } from './veri.js';
import { degerApi, degerBos, ozet } from './kurallar/degerler.js';

// Fonksiyon silinmeden önce: her kayıttaki son değeri geçmişe (log) "alan: değer → (kaldırıldı)" olarak yazar,
// sonra o fonksiyonun değerlerini siler. Döner: { kayit: değeri olan kayıt sayısı }
export async function fonksiyonVerisiniGecmiseYaz(trx, uid, u) {
  const f = await trx('fonksiyonlar').where({ uid }).first();
  if (!f) return { kayit: 0 };
  const satirlar = await trx('degerler').where({ fn_uid: uid });
  const gruplar = new Map();
  for (const d of satirlar) {
    const k = (d.kart_id || '') + '|' + d.proje_id;
    if (!gruplar.has(k)) gruplar.set(k, { projeId: d.proje_id, kartId: d.kart_id, modulId: d.modul_id || f.modul_id, L: [] });
    gruplar.get(k).L.push(degerApi(d));
  }
  let kayit = 0;
  const ad = gruplar.size ? await adCozucu(trx) : undefined; // kişi/depo kimlikleri yerine adlar
  for (const g of gruplar.values()) {
    const L = g.L.filter((r) => !degerBos(f.tip, r)).sort((a, b) => (a.sira ?? 0) - (b.sira ?? 0));
    if (!L.length) continue;
    const metin = L.map((r) => ozet({ ...r, fnTip: f.tip }, ad)).filter(Boolean).join(' | ').slice(0, 4000);
    await logYaz(trx, u, g, { tip: 'alan', alan: f.ad, eski: metin, yeni: '', metin: `"${f.ad}" fonksiyonu modülden kaldırıldı; son değer geçmişte saklandı` });
    kayit++;
  }
  await trx('degerler').where({ fn_uid: uid }).del();
  return { kayit };
}

