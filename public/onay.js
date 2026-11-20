// Dış onay sayfası: QR ile açılan şifresiz, süreli belge görüntüleme ve yanıt.
// Anahtar adresin # kısmındadır (sunucu kayıtlarına ve yönlendiren bilgisine düşmez).
// Belge, betik çalıştıramayan kapalı bir çerçevede (sandbox) gösterilir.
(function () {
  'use strict';
  const kok = document.getElementById('kok');
  const anahtar = location.hash.slice(1);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tarih = (iso) => new Date(iso).toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const mesaj = (ikon, baslik, metin) => { kok.innerHTML = `<div class="kart sonuc"><div class="ikon">${ikon}</div><h1>${esc(baslik)}</h1><p class="bilgi">${esc(metin || '')}</p></div>`; };

  if (!/^[A-Za-z0-9_-]{43}$/.test(anahtar)) { mesaj('⚠️', 'Bağlantı geçersiz', 'QR kodu yeniden okutun ya da belgeyi gönderen firmayla iletişime geçin.'); return; }
  const yol = '/api/dis/' + encodeURIComponent(anahtar);

  async function istek(yontem, govde) {
    const r = await fetch(yol, { method: yontem, headers: govde ? { 'Content-Type': 'application/json' } : {}, body: govde ? JSON.stringify(govde) : undefined, credentials: 'omit', cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) { /* boş */ }
    if (!r.ok) { const h = new Error(j.hata || 'Bağlantı kurulamadı'); h.durum = r.status; throw h; }
    return j;
  }

  function ust(v) {
    const logo = v.firma.logo ? `<img src="${esc(v.firma.logo)}" alt="">` : `<span class="harf">${esc((v.firma.ad || '?').slice(0, 2).toUpperCase())}</span>`;
    return `<div class="kart ust">${logo}<div><b>${esc(v.firma.ad)}</b><span>${esc(v.baslik || 'Belge')}</span></div>${v.son ? `<div class="sure">Geçerlilik<b>${esc(tarih(v.son))}</b></div>` : ''}</div>`;
  }

  // Belgede müşteri alanları işaretlenir; QR ve doldurulmamış iç alanlar gizlenir
  function belgeHtml(v) {
    let h = String(v.belge || '');
    h = h.replace(/\{\{\s*QR\s*\}\}/gi, '');
    h = h.replace(/\[\[\s*([^\[\]]+?)\s*\]\]|\{\{\s*m(?:ü|u)ş?teri\s*:\s*([^{}]+?)\s*\}\}/giu, (_, a, b) => `<mark>${(a || b).replace(/<[^>]*>/g, '')} ↓</mark>`);
    h = h.replace(/\{\{[^{}]*\}\}/g, '');
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
      body{margin:0;font:14px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#16203a;overflow-wrap:anywhere}
      table{border-collapse:collapse;width:100%!important;margin:6px 0;table-layout:auto!important}
      td,th{border:1px solid #c9cfdc;padding:6px 8px;vertical-align:top;text-align:left;width:auto!important;height:auto!important}
      th{background:#f1f3f8} img{max-width:100%;height:auto} h2{margin:0 0 10px;font-size:20px}
      mark{background:#fff3c4;padding:0 4px;border-radius:4px}</style></head><body>${h}</body></html>`;
  }

  function imzaKur(kap) {
    const c = kap.querySelector('canvas'), x = c.getContext('2d');
    let ciz = false, dolu = false;
    const boyut = () => { const r = c.getBoundingClientRect(), o = window.devicePixelRatio || 1; const eski = dolu ? c.toDataURL() : null; c.width = r.width * o; c.height = r.height * o; x.scale(o, o); x.lineWidth = 2.2; x.lineCap = 'round'; x.strokeStyle = '#111'; if (eski) { const i = new Image(); i.onload = () => x.drawImage(i, 0, 0, r.width, r.height); i.src = eski; } };
    boyut(); window.addEventListener('resize', boyut);
    const nokta = (e) => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    c.addEventListener('pointerdown', (e) => { ciz = true; dolu = true; c.setPointerCapture(e.pointerId); const [a, b] = nokta(e); x.beginPath(); x.moveTo(a, b); });
    c.addEventListener('pointermove', (e) => { if (!ciz) return; const [a, b] = nokta(e); x.lineTo(a, b); x.stroke(); });
    c.addEventListener('pointerup', () => { ciz = false; });
    kap.querySelector('button').addEventListener('click', () => { x.clearRect(0, 0, c.width, c.height); dolu = false; });
    return () => {
      if (!dolu) return '';
      // küçült: en fazla 900 px genişlik, PNG
      const o = document.createElement('canvas'), k = Math.min(1, 900 / c.width); o.width = Math.round(c.width * k); o.height = Math.round(c.height * k);
      o.getContext('2d').drawImage(c, 0, 0, o.width, o.height); return o.toDataURL('image/png');
    };
  }

  function goster(v) {
    const alanlar = v.alanlar || [];
    kok.innerHTML = ust(v) + `<div class="kart"><iframe class="belge" sandbox="allow-same-origin" title="Belge" referrerpolicy="no-referrer"></iframe></div>
      <div class="kart"><form id="f" novalidate>
        <h1>Yanıtınız</h1>
        ${alanlar.map((a, i) => a.tip === 'imza'
          ? `<div class="imza" data-i="${i}"><label>${esc(a.ad)}</label><canvas aria-label="${esc(a.ad)} için imza alanı"></canvas><button type="button" class="btn">Temizle</button></div>`
          : `<label>${esc(a.ad)}<input type="text" data-i="${i}" maxlength="500" autocomplete="off"></label>`).join('')}
        ${v.onay ? `<div class="karar" role="radiogroup" aria-label="Karar"><label class="onay"><input type="radio" name="karar" value="onay">Onaylıyorum</label><label class="red"><input type="radio" name="karar" value="red">Reddediyorum</label></div>` : ''}
        ${v.not ? `<label>Not<textarea name="notu" maxlength="2000" placeholder="Eklemek istedikleriniz (red için gerekçe)"></textarea></label>` : ''}
        <p class="hata" id="hata" hidden></p>
        <button class="btn pri" type="submit">Gönder</button>
        <p class="bilgi">Gönderdikten sonra yanıt değiştirilemez. Bağlantı ${esc(tarih(v.son))} tarihine kadar geçerlidir.</p>
      </form></div>`;
    const fr = kok.querySelector('iframe');
    fr.addEventListener('load', () => { try { fr.style.height = (fr.contentDocument.documentElement.scrollHeight + 8) + 'px'; } catch (e) { /* boyut alınamadı */ } });
    fr.srcdoc = belgeHtml(v);
    const imzalar = {};
    kok.querySelectorAll('.imza').forEach((k) => { imzalar[k.dataset.i] = imzaKur(k); });
    const f = document.getElementById('f'), hata = document.getElementById('hata');
    f.addEventListener('submit', async (e) => {
      e.preventDefault(); hata.hidden = true;
      const g = { alanlar: {} };
      alanlar.forEach((a, i) => { g.alanlar[a.ad] = a.tip === 'imza' ? imzalar[i]() : (f.querySelector(`input[data-i="${i}"]`).value || '').trim(); });
      const eksik = alanlar.filter((a) => !g.alanlar[a.ad]).map((a) => a.ad);
      if (v.onay) g.karar = (f.querySelector('input[name=karar]:checked') || {}).value || '';
      if (v.not) g.notu = f.elements.notu.value.trim();
      if (eksik.length) { hata.textContent = 'Doldurun: ' + eksik.join(', '); hata.hidden = false; return; }
      if (v.onay && !g.karar) { hata.textContent = 'Onaylıyor musunuz, reddediyor musunuz? Birini seçin.'; hata.hidden = false; return; }
      if (v.onay && g.karar === 'red' && v.not && !g.notu) { hata.textContent = 'Red için kısa bir gerekçe yazın.'; hata.hidden = false; return; }
      if (!confirm(g.karar === 'red' ? 'Belge REDDEDİLECEK. Gönderilsin mi?' : g.karar === 'onay' ? 'Belge ONAYLANACAK. Gönderilsin mi?' : 'Yanıt gönderilsin mi?')) return;
      const b = f.querySelector('[type=submit]'); b.disabled = true; b.textContent = 'Gönderiliyor…';
      try {
        const s = await istek('POST', g);
        mesaj(s.karar === 'red' ? '✋' : '✅', s.karar === 'red' ? 'Reddiniz iletildi' : s.karar === 'onay' ? 'Onayınız iletildi' : 'Yanıtınız iletildi', 'Teşekkürler. Bu sayfayı kapatabilirsiniz.');
      } catch (er) { hata.textContent = er.message; hata.hidden = false; b.disabled = false; b.textContent = 'Gönder'; }
    });
  }

  istek('GET').then((v) => {
    if (v.durum === 'yanitlandi') return mesaj('✔️', 'Bu belge yanıtlandı', `${v.karar === 'red' ? 'Reddedildi' : v.karar === 'onay' ? 'Onaylandı' : 'Yanıtlandı'} · ${tarih(v.yanitZaman)}`);
    document.title = (v.baslik || 'Belge') + ' · ' + v.firma.ad;
    goster(v);
  }).catch((e) => {
    if (e.durum === 410) return mesaj('⌛', e.message, 'Yeni bir bağlantı için belgeyi gönderen firmayla iletişime geçin.');
    mesaj('⚠️', e.message || 'Belge açılamadı', 'QR kodu yeniden okutun.');
  });
})();
