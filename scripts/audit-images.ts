// Аудит изображений всего сайта: скины, изображения по качеству, обложки кейсов, инвентарь.
//   npm run audit:images                 — офлайн-проверка базы и локальных файлов
//   npm run audit:images -- --online     — плюс запрос каждого внешнего адреса (CDN Steam)
//   npm run audit:images -- --json out.json
// Код выхода 1, если есть отсутствующие или битые изображения, дубли или проблемные обложки.
import fs from 'node:fs';
import path from 'node:path';
import { all, DATA } from '../src/lib/db.ts';
import { imageAudit } from '../src/lib/imageaudit.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const rep: any = imageAudit({ limit: 100000 });

if (args.includes('--online')) {
  const urls = [...new Set([...all("SELECT image u FROM items WHERE archived=0 AND image LIKE 'https://%'"), ...all("SELECT image u FROM item_images WHERE image LIKE 'https://%'")].map((r: any) => String(r.u)))];
  const failed: any[] = [];
  let i = 0;
  const worker = async () => {
    while (i < urls.length) {
      const u = urls[i++];
      let ok = false, status = 0;
      for (let a = 0; a < 3 && !ok; a++) {
        try { let r = await fetch(u, { method: 'HEAD', signal: AbortSignal.timeout(15000) }); if (!r.ok) r = await fetch(u, { signal: AbortSignal.timeout(20000) }); status = r.status; ok = r.ok && /^image\//.test(r.headers.get('content-type') || ''); }
        catch { status = 0; }
      }
      if (!ok) failed.push({ url: u, status });
    }
  };
  await Promise.all(Array.from({ length: 16 }, worker));
  rep.online = { checked: urls.length, failed: failed.length, failedUrls: failed.slice(0, 200) };
  rep.summary.remoteChecked = urls.length;
  rep.summary.remoteFailed = failed.length;
  rep.summary.brokenImageReferences += failed.length;
}

const s = rep.summary;
console.log('================ АУДИТ ИЗОБРАЖЕНИЙ ================');
console.log(`Скинов всего:                          ${s.skins}`);
console.log(`  с проверенным настоящим изображением: ${s.skinsVerified}`);
console.log(`  без изображения / битые:              ${s.skinsMissing}`);
console.log(`  источник не подтверждён:              ${s.skinsUnverified}`);
console.log(`  локальных / внешних (CDN Steam):      ${s.localImages} / ${s.remoteImages}`);
console.log(`Изображений по качеству:               ${s.wearImages} (битых: ${s.wearImagesBroken})`);
console.log(`Кейсов всего:                          ${s.cases}`);
console.log(`  с проверенной обложкой:               ${s.casesWithVerifiedCover}`);
console.log(`  проблемных / повторяющихся обложек:   ${s.coverProblems} / ${s.duplicateCovers}`);
console.log(`Битых ссылок на изображения:           ${s.brokenImageReferences}`);
console.log(`Одно изображение у разных скинов:      ${s.duplicateImageAssignments}`);
if (rep.online) console.log(`Онлайн-проверка CDN: ${rep.online.checked} адресов, ошибок: ${rep.online.failed}`);
for (const [k, title] of [['missing', 'Нет изображения'], ['unverified', 'Источник не подтверждён'], ['brokenWear', 'Битые изображения качества'], ['coverProblems', 'Обложки'], ['duplicateCovers', 'Одинаковые обложки'], ['duplicates', 'Дубли изображений']] as const) {
  const list = rep[k] || [];
  if (list.length) { console.log(`\n${title} (${list.length}):`); for (const x of list.slice(0, 25)) console.log('  -', JSON.stringify(x)); }
}
const out = opt('--json') || path.join(DATA, 'catalog', 'image-audit-latest.json');
fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rep, null, 1));
console.log('\nОтчёт:', path.resolve(out));
const bad = s.skinsMissing + s.wearImagesBroken + s.coverProblems + s.duplicateCovers + s.duplicateImageAssignments + (s.remoteFailed || 0);
process.exit(bad ? 1 : 0);
