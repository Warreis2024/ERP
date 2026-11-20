// Mesaj ve not ekleri.
//  • Küçük dosya: data URL (resim / ses / video), toplam ~3,2 MB (Vercel istek sınırı 4,5 MB).
//  • Büyük dosya: firmanın bulut deposuna (Google Drive / OneDrive, NetERP/<proje kodu>) parça parça yüklenir;
//    mesajda yalnız bağlantısı durur. Bağlantı yalnız bu sağlayıcıların adreslerine izin verir.
import { z } from 'zod';

export const EK_RE = /^data:(image\/(png|jpeg|webp)|audio\/(webm|ogg|mp4|mpeg|aac|x-m4a)|video\/(webm|mp4|quicktime))(;codecs=[\w.,]+)?;base64,[A-Za-z0-9+/]+=*$/;
const BULUT_HOST = /^(drive\.google\.com|docs\.google\.com|onedrive\.live\.com|1drv\.ms|[a-z0-9-]+(-my)?\.sharepoint\.com)$/i;
export function bulutAdresi(u) {
  try { const x = new URL(u); return x.protocol === 'https:' && BULUT_HOST.test(x.hostname); } catch { return false; }
}

const VeriEk = z.object({ ad: z.string().trim().max(120).default(''), url: z.string().max(3_600_000).regex(EK_RE, 'Desteklenmeyen dosya') });
const BulutEk = z.object({
  ad: z.string().trim().max(250).default(''),
  url: z.string().max(2000).refine(bulutAdresi, 'Desteklenmeyen dosya'),
  depo: z.enum(['gdrive', 'onedrive']),
  dosyaId: z.string().max(200).default(''),
  boyut: z.number().int().min(0).max(5 * 1024 ** 3).default(0),
  tip: z.string().max(150).default(''),
});
export const EkSema = z.array(z.union([BulutEk, VeriEk])).max(10).default([])
  .refine((L) => L.reduce((t, e) => t + (e.depo ? 0 : e.url.length), 0) <= 4_500_000, 'Ekler çok büyük (toplam 3 MB)');
