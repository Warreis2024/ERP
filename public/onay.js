// Dış onay sayfası: QR ile açılan şifresiz, süreli belge görüntüleme ve yanıt.
// Anahtar adresin # kısmındadır (sunucu kayıtlarına ve yönlendiren bilgisine düşmez).
// Belge, betik çalıştıramayan kapalı bir çerçevede (sandbox) gösterilir.
(function () {
  'use strict';
  const kok = document.getElementById('kok');
  // Dil: müşterinin tarayıcı dili (tr, en, de, es); yoksa Türkçe
  const DIL = ['en', 'de', 'es'].indexOf(String(navigator.language || '').slice(0, 2).toLowerCase());
  const SOZ = {"Bağlantı geçersiz": ["Invalid link", "Ungültiger Link", "Enlace no válido"], "QR kodu yeniden okutun ya da belgeyi gönderen firmayla iletişime geçin.": ["Scan the QR code again or contact the company that sent the document.", "Scannen Sie den QR-Code erneut oder wenden Sie sich an die Firma, die das Dokument gesendet hat.", "Vuelve a escanear el código QR o contacta con la empresa que envió el documento."], "Bağlantı kurulamadı": ["Could not connect", "Verbindung fehlgeschlagen", "No se pudo conectar"], "Geçerlilik": ["Valid until", "Gültig bis", "Válido hasta"], "için imza alanı": ["signature area", "Unterschriftsfeld", "área de firma"], "Temizle": ["Clear", "Löschen", "Borrar"], "Karar": ["Decision", "Entscheidung", "Decisión"], "Onaylıyorum": ["I approve", "Ich stimme zu", "Apruebo"], "Reddediyorum": ["I reject", "Ich lehne ab", "Rechazo"], "Not": ["Note", "Notiz", "Nota"], "Eklemek istedikleriniz (red için gerekçe)": ["Anything to add (reason if rejecting)", "Ergänzungen (Begründung bei Ablehnung)", "Lo que quieras añadir (motivo si rechazas)"], "Yanıtınız": ["Your response", "Ihre Antwort", "Tu respuesta"], "Belge": ["Document", "Dokument", "Documento"], "Doldurun: ": ["Please fill in: ", "Bitte ausfüllen: ", "Rellena: "], "Onaylıyor musunuz, reddediyor musunuz? Birini seçin.": ["Do you approve or reject? Choose one.", "Stimmen Sie zu oder lehnen Sie ab? Bitte wählen.", "¿Apruebas o rechazas? Elige una opción."], "Red için kısa bir gerekçe yazın.": ["Write a short reason for rejecting.", "Bitte kurz die Ablehnung begründen.", "Escribe un breve motivo del rechazo."], "Belge REDDEDİLECEK. Gönderilsin mi?": ["The document will be REJECTED. Send?", "Das Dokument wird ABGELEHNT. Senden?", "El documento será RECHAZADO. ¿Enviar?"], "Belge ONAYLANACAK. Gönderilsin mi?": ["The document will be APPROVED. Send?", "Das Dokument wird FREIGEGEBEN. Senden?", "El documento será APROBADO. ¿Enviar?"], "Yanıt gönderilsin mi?": ["Send the response?", "Antwort senden?", "¿Enviar la respuesta?"], "Gönderiliyor…": ["Sending…", "Wird gesendet…", "Enviando…"], "Reddiniz iletildi": ["Your rejection was sent", "Ihre Ablehnung wurde übermittelt", "Se ha enviado tu rechazo"], "Onayınız iletildi": ["Your approval was sent", "Ihre Freigabe wurde übermittelt", "Se ha enviado tu aprobación"], "Yanıtınız iletildi": ["Your response was sent", "Ihre Antwort wurde übermittelt", "Se ha enviado tu respuesta"], "Teşekkürler. Bu sayfayı kapatabilirsiniz.": ["Thank you. You can close this page.", "Vielen Dank. Sie können diese Seite schließen.", "Gracias. Puedes cerrar esta página."], "Gönder": ["Send", "Senden", "Enviar"], "Gönderdikten sonra yanıt değiştirilemez. Bağlantı {0} tarihine kadar geçerlidir.": ["The response cannot be changed after sending. The link is valid until {0}.", "Nach dem Senden kann die Antwort nicht geändert werden. Der Link ist bis {0} gültig.", "La respuesta no se puede cambiar después de enviarla. El enlace es válido hasta {0}."], "Bu belge yanıtlandı": ["This document has been answered", "Dieses Dokument wurde beantwortet", "Este documento ya fue respondido"], "Reddedildi": ["Rejected", "Abgelehnt", "Rechazado"], "Onaylandı": ["Approved", "Freigegeben", "Aprobado"], "Yanıtlandı": ["Answered", "Beantwortet", "Respondido"], "Yeni bir bağlantı için belgeyi gönderen firmayla iletişime geçin.": ["Contact the company that sent the document for a new link.", "Für einen neuen Link wenden Sie sich an die Firma, die das Dokument gesendet hat.", "Para un nuevo enlace, contacta con la empresa que envió el documento."], "Belge açılamadı": ["The document could not be opened", "Das Dokument konnte nicht geöffnet werden", "No se pudo abrir el documento"], "Bu bağlantı iptal edildi": ["This link was cancelled", "Dieser Link wurde widerrufen", "Este enlace fue cancelado"], "Bu bağlantının süresi doldu": ["This link has expired", "Dieser Link ist abgelaufen", "Este enlace ha caducado"], "Bu belge zaten yanıtlandı": ["This document has already been answered", "Dieses Dokument wurde bereits beantwortet", "Este documento ya fue respondido"], "Bu belge zaten yanıtlandı ya da süresi doldu": ["This document has already been answered or has expired", "Dieses Dokument wurde bereits beantwortet oder ist abgelaufen", "Este documento ya fue respondido o ha caducado"], "Çok fazla istek; biraz sonra yeniden dene": ["Too many requests; try again later", "Zu viele Anfragen; später erneut versuchen", "Demasiadas solicitudes; vuelve a intentarlo más tarde"], "Onay ya da red seçilmeli": ["Approve or reject must be chosen", "Freigabe oder Ablehnung muss gewählt werden", "Hay que elegir aprobar o rechazar"], "Red için not yazılmalı": ["A note is required for rejection", "Für eine Ablehnung ist eine Notiz nötig", "Para rechazar hay que escribir una nota"]};
  const L = (m, ...a) => { const x = DIL >= 0 && SOZ[m] ? SOZ[m][DIL] : m; return a.length ? x.replace(/\{(\d+)\}/g, (_, i) => a[+i] ?? '') : x; };
  if (DIL >= 0) document.documentElement.lang = ['en', 'de', 'es'][DIL];
  const anahtar = location.hash.slice(1);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tarih = (iso) => new Date(iso).toLocaleString(['en-GB','de-DE','es-ES'][DIL]||'tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const mesaj = (ikon, baslik, metin) => { kok.innerHTML = `<div class="kart sonuc"><div class="ikon">${ikon}</div><h1>${esc(baslik)}</h1><p class="bilgi">${esc(metin || '')}</p></div>`; };

  if (!/^[A-Za-z0-9_-]{43}$/.test(anahtar)) { mesaj('⚠️', L('Bağlantı geçersiz'), L('QR kodu yeniden okutun ya da belgeyi gönderen firmayla iletişime geçin.')); return; }
  const yol = '/api/dis/' + encodeURIComponent(anahtar);

  async function istek(yontem, govde) {
    const r = await fetch(yol, { method: yontem, headers: govde ? { 'Content-Type': 'application/json' } : {}, body: govde ? JSON.stringify(govde) : undefined, credentials: 'omit', cache: 'no-store' });
    let j = {}; try { j = await r.json(); } catch (e) { /* boş */ }
    if (!r.ok) { const h = new Error(j.hata ? L(j.hata) : L('Bağlantı kurulamadı')); h.durum = r.status; throw h; }
    return j;
  }

  function ust(v) {
    const logo = v.firma.logo ? `<img src="${esc(v.firma.logo)}" alt="">` : `<span class="harf">${esc((v.firma.ad || '?').slice(0, 2).toUpperCase())}</span>`;
    return `<div class="kart ust">${logo}<div><b>${esc(v.firma.ad)}</b><span>${esc(v.baslik || 'Belge')}</span></div>${v.son ? `<div class="sure">${L('Geçerlilik')}<b>${esc(tarih(v.son))}</b></div>` : ''}</div>`;
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
        <h1>${L('Yanıtınız')}</h1>
        ${alanlar.map((a, i) => a.tip === 'imza'
          ? `<div class="imza" data-i="${i}"><label>${esc(a.ad)}</label><canvas aria-label="${esc(a.ad)} · ${L('için imza alanı')}"></canvas><button type="button" class="btn">${L('Temizle')}</button></div>`
          : `<label>${esc(a.ad)}<input type="text" data-i="${i}" maxlength="500" autocomplete="off"></label>`).join('')}
        ${v.onay ? `<div class="karar" role="radiogroup" aria-label="${L('Karar')}"><label class="onay"><input type="radio" name="karar" value="onay">${L('Onaylıyorum')}</label><label class="red"><input type="radio" name="karar" value="red">${L('Reddediyorum')}</label></div>` : ''}
        ${v.not ? `<label>${L('Not')}<textarea name="notu" maxlength="2000" placeholder="${L('Eklemek istedikleriniz (red için gerekçe)')}"></textarea></label>` : ''}
        <p class="hata" id="hata" hidden></p>
        <button class="btn pri" type="submit">${L('Gönder')}</button>
        <p class="bilgi">${L('Gönderdikten sonra yanıt değiştirilemez. Bağlantı {0} tarihine kadar geçerlidir.', esc(tarih(v.son)))}</p>
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
      if (eksik.length) { hata.textContent = L('Doldurun: ') + eksik.join(', '); hata.hidden = false; return; }
      if (v.onay && !g.karar) { hata.textContent = L('Onaylıyor musunuz, reddediyor musunuz? Birini seçin.'); hata.hidden = false; return; }
      if (v.onay && g.karar === 'red' && v.not && !g.notu) { hata.textContent = L('Red için kısa bir gerekçe yazın.'); hata.hidden = false; return; }
      if (!confirm(g.karar === 'red' ? L('Belge REDDEDİLECEK. Gönderilsin mi?') : g.karar === 'onay' ? L('Belge ONAYLANACAK. Gönderilsin mi?') : L('Yanıt gönderilsin mi?'))) return;
      const b = f.querySelector('[type=submit]'); b.disabled = true; b.textContent = L('Gönderiliyor…');
      try {
        const s = await istek('POST', g);
        mesaj(s.karar === 'red' ? '✋' : '✅', s.karar === 'red' ? L('Reddiniz iletildi') : s.karar === 'onay' ? L('Onayınız iletildi') : L('Yanıtınız iletildi'), L('Teşekkürler. Bu sayfayı kapatabilirsiniz.'));
      } catch (er) { hata.textContent = er.message; hata.hidden = false; b.disabled = false; b.textContent = L('Gönder'); }
    });
  }

  istek('GET').then((v) => {
    if (v.durum === 'yanitlandi') return mesaj('✔️', L('Bu belge yanıtlandı'), `${v.karar === 'red' ? L('Reddedildi') : v.karar === 'onay' ? L('Onaylandı') : L('Yanıtlandı')} · ${tarih(v.yanitZaman)}`);
    document.title = (v.baslik || 'Belge') + ' · ' + v.firma.ad;
    goster(v);
  }).catch((e) => {
    if (e.durum === 410) return mesaj('⌛', e.message, L('Yeni bir bağlantı için belgeyi gönderen firmayla iletişime geçin.'));
    mesaj('⚠️', e.message || L('Belge açılamadı'), 'QR kodu yeniden okutun.');
  });
})();
