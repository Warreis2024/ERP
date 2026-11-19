import { ZodError } from 'zod';

export class HttpHata extends Error {
  constructor(durum, mesaj, ek) { super(mesaj); this.durum = durum; this.ek = ek; }
}

// Express hata yakalayıcı. İç ayrıntı (SQL, yığın) istemciye gönderilmez.
export function hataYakala(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ hata: 'Geçersiz veri', alanlar: err.issues.map((i) => ({ yol: i.path.join('.'), mesaj: i.message })) });
  }
  if (err instanceof HttpHata) return res.status(err.durum).json({ hata: err.message, ...(err.ek || {}) });
  if (err?.type === 'entity.too.large') return res.status(413).json({ hata: 'İstek çok büyük' });
  console.error(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`, err);
  res.status(500).json({ hata: 'Sunucu hatası' });
}
