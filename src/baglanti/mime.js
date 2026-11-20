// En basit haliyle MIME e-posta çözümü (bağımlılıksız): başlıklar, RFC 2047 kodlu sözcükler,
// çok parçalı gövde, base64 / quoted-printable, karakter kümesi. Düz metin gövde ve ek adlarını verir.

export function karakterCoz(buf, charset) {
  const cs = String(charset || 'utf-8').toLowerCase().replace(/^"|"$/g, '');
  try { return new TextDecoder(cs === 'utf8' ? 'utf-8' : cs, { fatal: false }).decode(buf); } catch { return new TextDecoder('utf-8').decode(buf); }
}

const qpBayt = (s, baslik) => {
  if (baslik) s = s.replace(/_/g, ' ');
  s = s.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else { const b = Buffer.from(s[i], 'latin1'); out.push(b[0]); }
  }
  return Buffer.from(out);
};

// =?utf-8?B?...?= ve =?iso-8859-9?Q?...?=
export function baslikCoz(s) {
  return String(s || '').replace(/\?=\s+=\?/g, '?==?').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, k, v) => {
    const b = /b/i.test(k) ? Buffer.from(v, 'base64') : qpBayt(v, true);
    return karakterCoz(b, cs.split('*')[0]);
  });
}

export function basliklar(metin) {
  const o = {};
  const satir = String(metin).replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/);
  for (const s of satir) {
    const i = s.indexOf(':'); if (i < 1) continue;
    const k = s.slice(0, i).trim().toLowerCase(), v = s.slice(i + 1).trim();
    if (!(k in o)) o[k] = v;
  }
  return o;
}

// Content-Type: text/plain; charset="utf-8"; boundary=...
export function parametreler(v) {
  const [tur, ...p] = String(v || '').split(';');
  const o = { tur: tur.trim().toLowerCase() };
  for (const x of p) { const i = x.indexOf('='); if (i > 0) o[x.slice(0, i).trim().toLowerCase()] = x.slice(i + 1).trim().replace(/^"|"$/g, ''); }
  return o;
}

function govdeCoz(ham, kodlama) {
  const k = String(kodlama || '').toLowerCase();
  if (k === 'base64') return Buffer.from(ham.toString('latin1').replace(/[^A-Za-z0-9+/=]/g, ''), 'base64');
  if (k === 'quoted-printable') return qpBayt(ham.toString('latin1'), false);
  return ham;
}

const htmlDuz = (h) => String(h).replace(/<(style|script)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d)>/gi, '\n')
  .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
  .replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();

// Bir parçayı (başlık + gövde Buffer) gezer
function parcaGez(buf, sonuc, derinlik = 0) {
  if (derinlik > 8) return;
  const ayr = buf.indexOf('\r\n\r\n') >= 0 ? buf.indexOf('\r\n\r\n') : buf.indexOf('\n\n');
  const bs = ayr >= 0 ? buf.slice(0, ayr).toString('latin1') : buf.toString('latin1');
  const govde = ayr >= 0 ? buf.slice(ayr + (buf[ayr] === 13 ? 4 : 2)) : Buffer.alloc(0);
  const h = basliklar(bs), ct = parametreler(h['content-type'] || 'text/plain'), cd = parametreler(h['content-disposition'] || '');
  if (ct.tur.startsWith('multipart/') && ct.boundary) {
    const sinir = Buffer.from('--' + ct.boundary);
    let i = govde.indexOf(sinir);
    while (i >= 0) {
      const bas = govde.indexOf('\n', i) + 1; if (bas <= 0) break;
      const son = govde.indexOf(sinir, bas); if (son < 0) break;
      parcaGez(govde.slice(bas, son), sonuc, derinlik + 1);
      if (govde.slice(son + sinir.length, son + sinir.length + 2).toString() === '--') break;
      i = son;
    }
    return;
  }
  const ad = baslikCoz(cd.filename || ct.name || '');
  if (cd.tur === 'attachment' || (ad && !ct.tur.startsWith('text/'))) { sonuc.ekler.push(ad || 'ek'); return; }
  const metin = karakterCoz(govdeCoz(govde, h['content-transfer-encoding']), ct.charset);
  if (ct.tur === 'text/plain' && !sonuc.duz) sonuc.duz = metin;
  else if (ct.tur === 'text/html' && !sonuc.html) sonuc.html = metin;
}

// Ham ileti → { konu, kimden, kimdenAd, kimdenAdres, mesajId, tarih, metin, ekler }
export function iletiCoz(ham) {
  const buf = Buffer.isBuffer(ham) ? ham : Buffer.from(String(ham), 'latin1');
  const ayr = buf.indexOf('\r\n\r\n') >= 0 ? buf.indexOf('\r\n\r\n') : buf.indexOf('\n\n');
  const h = basliklar((ayr >= 0 ? buf.slice(0, ayr) : buf).toString('latin1'));
  const sonuc = { duz: '', html: '', ekler: [] };
  parcaGez(buf, sonuc);
  const kimden = baslikCoz(h.from || '');
  const m = kimden.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  const adres = (m ? m[2] : kimden).trim().toLowerCase();
  let metin = sonuc.duz || htmlDuz(sonuc.html);
  metin = metin.replace(/\r\n/g, '\n').trim();
  return {
    konu: baslikCoz(h.subject || '').trim(), kimden, kimdenAd: (m ? m[1] : '').trim(), kimdenAdres: /^[^\s@]+@[^\s@]+$/.test(adres) ? adres : '',
    mesajId: (h['message-id'] || '').trim().slice(0, 250), tarih: h.date || '', metin, ekler: sonuc.ekler,
  };
}

// Alıntılanmış eski yazışmayı keser (yanıt e-postalarında)
export function alintiKes(metin) {
  const L = String(metin || '').split('\n'), out = [];
  for (const s of L) {
    if (/^\s*>/.test(s)) continue;
    if (/^(On|Am|El|Le) .+(wrote|schrieb|escribió|a écrit):\s*$/i.test(s.trim()) || /tarihinde .+ şunu yazdı:\s*$/i.test(s.trim()) || /^-{2,}\s*(Original Message|Orijinal ileti|Ursprüngliche Nachricht)/i.test(s.trim()) || /^From: /i.test(s.trim())) break;
    out.push(s);
  }
  return out.join('\n').trim();
}
