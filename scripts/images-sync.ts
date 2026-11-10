// Локальное хранение изображений: скачивает официальные изображения Steam, на которые ещё ссылаются по адресу CDN
// (основные и по качеству), в public/img/skins/<предмет>/<качество>.png и переключает ссылки в базе на локальные файлы.
//   npm run images:sync                — все внешние изображения
//   npm run images:sync -- --limit 500 — частями
// Проверка: HTTP 200, тип image/*, сигнатура PNG/WebP/JPEG. Ничего не удаляет; при ошибке ссылка остаётся прежней.
import fs from 'node:fs';
import path from 'node:path';
import { all, run, one, ROOT } from '../src/lib/db.ts';
import { audit } from '../src/lib/core.ts';

const args = process.argv.slice(2);
const opt = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const LIMIT = Number(opt('--limit') || 1e9);
const DIR = path.join(ROOT, 'public', 'img', 'skins');
const HOSTS = /^https:\/\/(community\.akamai\.steamstatic\.com|community\.cloudflare\.steamstatic\.com|steamcommunity-a\.akamaihd\.net|steamcdn-a\.akamaihd\.net)\//;
const slug = (s: string) => s.toLowerCase().replace(/★/g, '').replace(/™/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
const sig = (b: Buffer) => (b.readUInt32BE(0) === 0x89504e47 ? 'png' : b.toString('ascii', 8, 12) === 'WEBP' ? 'webp' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : null);

type Job = { url: string; itemId: number; name: string; phase: string | null; wear: string; main: boolean };
const jobs: Job[] = [];
for (const r of all("SELECT id, name, phase, image FROM items WHERE archived=0 AND image LIKE 'https://%'")) if (HOSTS.test(r.image)) jobs.push({ url: r.image, itemId: r.id, name: r.name, phase: r.phase, wear: 'main', main: true });
for (const r of all("SELECT ii.item_id, ii.wear, ii.image, i.name, i.phase FROM item_images ii JOIN items i ON i.id=ii.item_id WHERE ii.image LIKE 'https://%'")) if (HOSTS.test(r.image)) jobs.push({ url: r.image, itemId: r.item_id, name: r.name, phase: r.phase, wear: r.wear || 'any', main: false });
const byUrl = new Map<string, Job>();
for (const j of jobs) if (!byUrl.has(j.url)) byUrl.set(j.url, j);
const urls = [...byUrl.keys()].slice(0, LIMIT);
console.log(`Внешних изображений: ${new Set(jobs.map((j) => j.url)).size}, обрабатываем: ${urls.length}`);
const local = new Map<string, string>();
let ok = 0, fail = 0, i = 0;
const worker = async () => {
  while (i < urls.length) {
    const url = urls[i++];
    const j = byUrl.get(url)!;
    const dir = slug(j.name) + (j.phase ? '-' + slug(j.phase) : '');
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const buf = Buffer.from(await r.arrayBuffer());
      const kind = sig(buf);
      if (!r.ok || !/^image\//.test(r.headers.get('content-type') || '') || !kind || buf.length > 5 * 1024 * 1024) throw new Error('HTTP ' + r.status);
      let name = `${dir}/${j.wear.toLowerCase()}.${kind}`;
      for (let n = 2; fs.existsSync(path.join(DIR, name)) && fs.readFileSync(path.join(DIR, name)).compare(buf) !== 0; n++) name = `${dir}/${j.wear.toLowerCase()}-${n}.${kind}`;
      fs.mkdirSync(path.join(DIR, dir), { recursive: true });
      fs.writeFileSync(path.join(DIR, name), buf);
      local.set(url, '/img/skins/' + name);
      ok++;
    } catch { fail++; }
    if ((ok + fail) % 250 === 0) console.log(`  ${ok + fail}/${urls.length}`);
  }
};
await Promise.all(Array.from({ length: 8 }, worker));
let rows = 0;
for (const [url, p] of local) {
  rows += run("UPDATE items SET image=?, image_source=COALESCE(image_source, ?), image_status='verified', image_checked_at=? WHERE image=?", p, url, Date.now(), url).changes;
  rows += run('UPDATE item_images SET image=?, source=COALESCE(source, ?), verified_at=? WHERE image=?', p, url, Date.now(), url).changes;
}
audit(null, 'images.sync', 'items', null, { downloaded: ok, failed: fail, rows }, 'cli');
console.log(`Готово: сохранено ${ok}, ошибок ${fail}, обновлено ссылок ${rows}. Осталось внешних: ${one("SELECT COUNT(*) n FROM items WHERE image LIKE 'https://%'").n} основных.`);
