// Автотест версии 4: каталог, новые кейсы, шансы, изображения, открытие, Provably Fair, апгрейдер, админка.
// Поднимает сайт на временной базе, собранной ТОЛЬКО из пакета catalog/v4 (без сети и без data/), и удаляет её после проверки.
// Запуск: npm run test:v4
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'burger-v4-'));
process.env.DATA_DIR = dir;
delete process.env.DB_FILE;
const dbm: any = await import('../src/lib/db.ts');
dbm.migrate();
const { seed } = await import('../scripts/seed.ts');
seed();
const { one, all, run } = dbm;
const ROOT = dbm.ROOT;

let failed = 0, passed = 0;
function check(name: string, ok: boolean, info = '') { if (ok) { passed++; console.log('  OK   ' + name); } else { failed++; console.log('  FAIL ' + name + (info ? ' -> ' + String(info).slice(0, 300) : '')); } }
console.log('BURGER SKIN v4: автотест на временной базе ' + dir);

// Старая база: «склеенная» строка Doppler без фазы и предмет в инвентаре игрока — должны сохраниться.
const legacyId = run("INSERT INTO items(name,weapon,category,pattern,rarity_name,rarity_color,min_float,max_float,stattrak,image,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
  '★ Karambit | Doppler', 'Karambit', 'Knives', 'Doppler', 'Extraordinary', '#e4ae39', 0, 0.08, 1, 'https://community.akamai.steamstatic.com/economy/image/legacy-merged', Date.now(), Date.now()).lastInsertRowid;
run("INSERT INTO users(login,nickname,role,balance,created_at) VALUES('legacy','Legacy','USER',12345,?)", Date.now());
const legacyUser = one("SELECT id FROM users WHERE login='legacy'").id;
const legacyInv = run("INSERT INTO inventory(user_id,item_id,wear,float,variant,price,status,source,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)", legacyUser, legacyId, 'FN', 0.01, '', 9000000, 'owned', 'case', Date.now(), Date.now()).lastInsertRowid;

const { seedV4 } = await import('../scripts/seed-cases-v4.ts');
const res1 = seedV4({ log: () => {} });
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'v4', 'cases.json'), 'utf8'));
const ipkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'catalog', 'v4', 'items.json'), 'utf8'));
check('Пакет: 30–50 новых кейсов', pkg.cases.length >= 30 && pkg.cases.length <= 50, String(pkg.cases.length));
check('Все кейсы пакета созданы', res1.rep.cases.added.length === pkg.cases.length && !res1.rep.cases.failed.length, JSON.stringify(res1.rep.cases.failed));
check('Фазы Doppler добавлены отдельными предметами', one('SELECT COUNT(*) n FROM items WHERE phase IS NOT NULL').n === ipkg.items.filter((x: any) => x.phase).length);
const leg = one('SELECT * FROM items WHERE id=?', legacyId);
check('Склеенная строка Doppler получила фазу и изображение этой фазы', !!leg.phase && leg.image !== 'https://community.akamai.steamstatic.com/economy/image/legacy-merged' && leg.image_status === 'verified', JSON.stringify(leg));
const li = one('SELECT * FROM inventory WHERE id=?', legacyInv);
check('Инвентарь старого игрока не изменился', li && li.item_id === legacyId && li.price === 9000000 && li.status === 'owned' && one('SELECT balance FROM users WHERE id=?', legacyUser).balance === 12345);
const res2 = seedV4({ log: () => {} });
check('Повторный запуск ничего не дублирует', res2.rep.items.added === 0 && res2.rep.cases.added.length === 0 && res2.rep.prices.added === 0, JSON.stringify({ i: res2.rep.items.added, c: res2.rep.cases.added.length, p: res2.rep.prices.added }));

// ---------- Шансы, цены, изображения (прямо из базы) ----------
const { caseRows, pickWeighted, dropFrom, caseDetail, itemEV } = await import('../src/lib/cases.ts');
const { wearsAvailable, floatsFrom } = await import('../src/lib/core.ts');
const { imageAudit, checkImage } = await import('../src/lib/imageaudit.ts');
const v4 = all("SELECT * FROM cases WHERE source='seed-v4' AND status='published'");
let sumBad = 0, priceBad = 0, imgBad = 0, rangeBad = 0, evBad = 0;
const notes: string[] = [];
for (const c of v4) {
  const rows = caseRows(c.id);
  const W = rows.reduce((s: number, r: any) => s + r.weight, 0);
  if (W !== 1_000_000 || !rows.every((r: any) => Number.isInteger(r.weight) && r.weight > 0)) { sumBad++; notes.push(c.slug + ': веса ' + W); }
  // Каждый предмет реально может выпасть: его отрезок билетов [lo, hi) не пуст.
  let acc = 0;
  for (const r of rows) { const p = pickWeighted(rows, (acc + r.weight / 2) / W); if (p.row.id !== r.id) { rangeBad++; notes.push(c.slug + ': ' + r.name); } acc += r.weight; }
  for (const r of rows) {
    for (const w of wearsAvailable(r)) for (const v of ['', ...(r.stattrak ? ['st'] : [])]) if (!one('SELECT 1 FROM item_prices WHERE item_id=? AND wear=? AND variant=?', r.id, w, v)) { priceBad++; notes.push(`${c.slug}: нет цены ${r.name} ${w}${v}`); }
    if (!checkImage(r.image).ok) { imgBad++; notes.push(`${c.slug}: изображение ${r.name}`); }
    for (const w of wearsAvailable(r)) { const im = one('SELECT image FROM item_images WHERE item_id=? AND wear=?', r.id, w); if (!im || !checkImage(im.image).ok) { imgBad++; notes.push(`${c.slug}: изображение ${r.name} ${w}`); } }
  }
  const ev = Math.round(rows.reduce((s: number, r: any) => s + (r.weight / W) * itemEV(r, c), 0));
  if (Math.abs(ev - c.ev) > 1 || c.price !== Math.max(100, Math.round(ev * 1.12))) { evBad++; notes.push(`${c.slug}: EV ${ev} vs ${c.ev}, цена ${c.price}`); }
}
check(`Шансы каждого из ${v4.length} кейсов в сумме ровно 100% (целые веса, сумма 1 000 000)`, sumBad === 0, notes.join('; '));
check('Каждый предмет каждого кейса может выпасть (непустой диапазон билетов)', rangeBad === 0, notes.join('; '));
check('У каждого предмета есть настоящая цена для всех качеств (и StatTrak)', priceBad === 0, notes.slice(0, 5).join('; '));
check('У каждого предмета и каждого качества есть проверенное изображение', imgBad === 0, notes.slice(0, 5).join('; '));
check('Цена кейса = ожидаемая стоимость по реальным ценам × (1 + маржа)', evBad === 0, notes.slice(0, 5).join('; '));
const det = caseDetail(v4[0]);
check('API кейса отдаёт точные шансы (exact) и их сумма = 1', det.exact === true && Math.abs(det.items.reduce((s: number, x: any) => s + x.chance, 0) - 1) < 1e-12);

// Частоты выпадения совпадают с заявленными шансами (200 000 бросков на сервере, отклонение < 5 сигм).
{
  const c = one("SELECT * FROM cases WHERE slug='first-bite'");
  const rows = caseRows(c.id);
  const W = rows.reduce((s: number, r: any) => s + r.weight, 0);
  const N = 200_000; const cnt = new Map<number, number>();
  for (let k = 0; k < N; k++) { const f = floatsFrom('test-seed', 'client', k, 3); const d = dropFrom(c, rows, f); cnt.set(d.item.id, (cnt.get(d.item.id) || 0) + 1); }
  let worst = 0;
  for (const r of rows) { const p = r.weight / W; const z = Math.abs((cnt.get(r.id) || 0) - N * p) / Math.sqrt(N * p * (1 - p)); worst = Math.max(worst, z); }
  check('Частоты 200 000 выпадений соответствуют заявленным шансам', worst < 5, 'макс. z = ' + worst.toFixed(2));
}
const audit0 = imageAudit();
const s = audit0.summary;
check('Аудит: у всех скинов проверенные изображения', s.skinsMissing === 0 && s.skinsUnverified === 0 && s.skinsVerified === s.skins, JSON.stringify(s));
check('Аудит: у всех кейсов проверенные уникальные обложки', s.casesWithVerifiedCover === s.cases && s.duplicateCovers === 0 && s.coverProblems === 0, JSON.stringify({ c: audit0.coverProblems.slice(0, 3), d: audit0.duplicateCovers.slice(0, 3) }));
check('Аудит: нет битых ссылок и дублей изображений', s.brokenImageReferences === 0 && s.duplicateImageAssignments === 0, JSON.stringify(audit0.duplicates.slice(0, 3)));

// ---------- HTTP ----------
const { start } = await import('../src/server.ts');
const port = 22000 + Math.floor(Math.random() * 2000);
const server = start(port);
await new Promise((r) => setTimeout(r, 500));
const base = 'http://127.0.0.1:' + port;
const jar: Record<string, string> = {};
async function req(method: string, p: string, body?: unknown) {
  const headers: Record<string, string> = { cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ') };
  if (method !== 'GET') { headers['content-type'] = 'application/json'; headers['x-csrf-token'] = jar.bs_csrf || ''; headers['idempotency-key'] = crypto.randomUUID(); }
  const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  for (const c of r.headers.getSetCookie()) { const kv = c.split(';')[0]; const i = kv.indexOf('='); const k = kv.slice(0, i), v = kv.slice(i + 1); if (v && !/max-age=0/i.test(c)) jar[k] = v; else delete jar[k]; }
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch { j = null; }
  return { status: r.status, j, t };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let r = await req('GET', '/api/cases');
check('Каталог: группы, счётчики, рекомендуемые', r.status === 200 && Array.isArray(r.j.groups) && r.j.groups.length === 7 && r.j.counts.featured > 0 && r.j.cases.every((c: any) => c.theme && c.accent), r.t.slice(0, 200));
r = await req('GET', '/api/cases?category=featured');
check('Фильтр «Рекомендуемые»', r.status === 200 && r.j.cases.length > 0 && r.j.cases.every((c: any) => c.featured));
r = await req('GET', '/api/cases?category=gloves&min=10000&sort=price_asc');
check('Фильтр по категории и цене + сортировка', r.status === 200 && r.j.cases.length > 0 && r.j.cases.every((c: any) => c.price >= 1_000_000 && c.categories.includes('gloves')) && r.j.cases.every((c: any, i: number, a: any[]) => !i || a[i - 1].price <= c.price));
r = await req('GET', '/api/cases?q=' + encodeURIComponent('Олимп'));
check('Поиск по названию кейса', r.status === 200 && r.j.cases.some((c: any) => c.slug === 'olympus'));
r = await req('GET', '/api/home');
check('Главная: рекомендуемые кейсы и картинка-герой из каталога', r.status === 200 && r.j.featured?.length > 0 && typeof r.j.heroImage === 'string' && !r.j.heroImage.includes('/img/brand/'));
for (const p of ['/img/skins/awp-dragon-lore/fn.webp', '/img/skins/karambit-doppler-ruby/fn.webp']) { const x = await fetch(base + p); check('Локальное изображение отдаётся: ' + p, x.status === 200 && x.headers.get('content-type') === 'image/webp'); }

r = await req('POST', '/api/auth/register', { login: 'v4tester', email: 'v4@example.com', password: 'Tester12345!', agree: true });
check('Регистрация', r.status === 200, r.t);
const me = one("SELECT * FROM users WHERE login='v4tester'");
run('UPDATE users SET balance=? WHERE id=?', 2_000_000_000, me.id);
r = await req('POST', '/api/admin/cases/1/normalize', {});
check('Игрок не может менять шансы кейса', r.status === 403, String(r.status));
r = await req('GET', '/api/admin/images-audit');
check('Игрок не видит аудит изображений', r.status === 403, String(r.status));

let openBad = 0, imgDrop = 0, opened = 0;
const bal0 = one('SELECT balance FROM users WHERE id=?', me.id).balance;
 const led0 = one('SELECT COALESCE(MAX(id),0) m FROM ledger').m;
let spent = 0;
for (const c of v4) {
  const o = await req('POST', `/api/cases/${c.slug}/open`, { count: 1 });
  if (o.status !== 200) { openBad++; notes.push(`${c.slug}: ${o.status} ${o.t.slice(0, 100)}`); await sleep(400); continue; }
  opened++; spent += c.price;
  const d = o.j.drops[0];
  const inCase = one('SELECT 1 FROM case_items WHERE case_id=? AND item_id=?', c.id, d.inv.itemId);
  const inv = one("SELECT * FROM inventory WHERE id=? AND user_id=? AND status='owned'", d.inv.id, me.id);
  if (!inCase || !inv || inv.item_id !== d.inv.itemId) { openBad++; notes.push(c.slug + ': предмет не из кейса'); }
  const want = one('SELECT image FROM item_images WHERE item_id=? AND wear=?', d.inv.itemId, d.inv.wear || '');
  if (want && !d.inv.image.endsWith(want.image.startsWith('/') ? want.image : Buffer.from(want.image).toString('base64url'))) { imgDrop++; notes.push(c.slug + ': изображение не своего качества'); }
  await sleep(380);
}
check(`Каждый из ${v4.length} новых кейсов открывается через API`, opened === v4.length && openBad === 0, notes.slice(-5).join('; '));
check('Выпавший предмет входит в состав кейса и записан в инвентарь', openBad === 0);
check('Изображение выпавшего предмета — именно его качества', imgDrop === 0, notes.slice(-3).join('; '));
const moves = one('SELECT COALESCE(SUM(amount),0) s FROM ledger WHERE user_id=? AND id>?', me.id, led0).s;
check('Баланс = начальный + все операции леджера (списания за кейсы и награды)', one('SELECT balance FROM users WHERE id=?', me.id).balance === bal0 + moves);
const ledger = one("SELECT COUNT(*) n, -SUM(amount) s FROM ledger WHERE user_id=? AND type='case'", me.id);
check('Каждое открытие записано в леджер', ledger.n === opened && ledger.s === spent, JSON.stringify(ledger));

// Повтор запроса с тем же Idempotency-Key не открывает кейс второй раз.
{
  const key = crypto.randomUUID();
  const h = () => ({ cookie: Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '), 'content-type': 'application/json', 'x-csrf-token': jar.bs_csrf || '', 'idempotency-key': key });
  const n0 = one("SELECT COUNT(*) n FROM bets WHERE user_id=? AND game='case'", me.id).n;
  const a = await fetch(base + '/api/cases/first-bite/open', { method: 'POST', headers: h(), body: JSON.stringify({ count: 1 }) });
  const b = await fetch(base + '/api/cases/first-bite/open', { method: 'POST', headers: h(), body: JSON.stringify({ count: 1 }) });
  const n1 = one("SELECT COUNT(*) n FROM bets WHERE user_id=? AND game='case'", me.id).n;
  check('Повтор с тем же Idempotency-Key не создаёт второе открытие', a.status === 200 && b.status === 200 && n1 === n0 + 1, `${a.status} ${b.status} ${n1 - n0}`);
}

// Provably Fair: после смены сида результат каждого открытия воспроизводится из раскрытого server seed.
{
  const bets = all("SELECT * FROM bets WHERE user_id=? AND game='case' ORDER BY id", me.id);
  const rot = await req('POST', '/api/fair/rotate', {});
  const seedRow = rot.j?.revealed;
  let bad = 0;
  for (const b of bets) {
    const d = JSON.parse(b.data);
    const c = one('SELECT * FROM cases WHERE id=?', d.caseId);
    const f = floatsFrom(seedRow.serverSeed, seedRow.clientSeed, b.nonce, 3);
    const x = dropFrom(c, caseRows(c.id), f);
    if (x.item.id !== d.itemId) bad++;
  }
  check(`Provably Fair: все ${bets.length} открытий воспроизводятся из раскрытого seed`, rot.status === 200 && bets.length > 0 && bad === 0, `bad=${bad}`);
}
// Кинодроп только классифицирует уже выданный предмет: смена порогов не меняет ни шансы, ни выдачу.
{
  const fx0 = JSON.stringify(caseDetail(one("SELECT * FROM cases WHERE slug='olympus'")).items.map((x: any) => [x.id, x.chance]));
  const { setSetting, getSetting } = await import('../src/lib/core.ts');
  setSetting('drop_fx', { ...getSetting('drop_fx'), trigger: 'standard', levels: { rare: 101, epic: 102, legendary: 103, godlike: 104 } });
  const fx1 = JSON.stringify(caseDetail(one("SELECT * FROM cases WHERE slug='olympus'")).items.map((x: any) => [x.id, x.chance]));
  check('Пороги кинодропа не меняют шансы кейса', fx0 === fx1);
  const o = await req('POST', '/api/cases/olympus/open', { count: 1 });
  const fx = o.j?.drops?.[0]?.fx;
  check('Сервер возвращает уровень кинодропа для выданного предмета', o.status === 200 && fx && ['standard', 'rare', 'epic', 'legendary', 'godlike'].includes(fx.level) && typeof fx.label === 'string', o.t.slice(0, 200));
  const sh = await req('GET', '/api/drops/' + o.j.drops[0].share);
  check('Публичная страница дропа отдаёт тот же уровень', sh.status === 200 && sh.j.drop.fx.level === fx.level);
}
// Апгрейдер работает с новыми предметами (цель — фаза Doppler).
{
  const inv = all("SELECT * FROM inventory WHERE user_id=? AND status='owned' ORDER BY price DESC LIMIT 1", me.id)[0];
  const target = one("SELECT i.id, p.wear, p.price FROM items i JOIN item_prices p ON p.item_id=i.id AND p.variant='' WHERE i.phase IS NOT NULL AND p.price > ? AND p.price < ? ORDER BY p.price LIMIT 1", inv.price * 1.5, inv.price * 15);
  const q = await req('POST', '/api/upgrade/quote', { ids: [inv.id], itemId: target.id, wear: target.wear });
  check('Апгрейдер: расчёт шанса для новой цели', q.status === 200 && q.j.chance > 0, q.t.slice(0, 200));
  const u = await req('POST', '/api/upgrade', { ids: [inv.id], itemId: target.id, wear: target.wear, expectInput: q.j.input, expectTarget: q.j.target ?? q.j.targetPrice ?? q.j.price });
  check('Апгрейдер: апгрейд выполнен (выигрыш или проигрыш), предмет списан', u.status === 200 && one('SELECT status FROM inventory WHERE id=?', inv.id).status === 'upgraded', u.t.slice(0, 200));
}
// Админка
run("UPDATE users SET role='OWNER' WHERE id=?", me.id);
await req('POST', '/api/auth/logout', {});
r = await req('POST', '/api/auth/login', { login: 'v4tester', password: 'Tester12345!' });
check('Вход владельца', r.status === 200, r.t);
const cs = one("SELECT * FROM cases WHERE slug='kilowatt-case'");
r = await req('POST', `/api/admin/cases/${cs.id}/normalize`, {});
check('Админка: «Точно 100%» — целые веса с суммой 1 000 000', r.status === 200 && r.j.case.exact === true && r.j.case.weightTotal === 1_000_000, r.t.slice(0, 200));
r = await req('POST', `/api/admin/cases/${cs.id}`, { featured: true, coverTheme: 'hex', accent: '#12ab34' });
check('Админка: витрина, тема и цвет кейса сохраняются', r.status === 200 && r.j.case.featured === true && r.j.case.theme === 'hex' && r.j.case.accent === '#12ab34', r.t.slice(0, 200));
r = await req('POST', `/api/admin/cases/${cs.id}`, { coverTheme: 'nope' });
check('Админка: неизвестная тема отклоняется', r.status === 400);
r = await req('GET', '/api/admin/images-audit');
check('Админка: аудит изображений доступен владельцу', r.status === 200 && r.j.summary.skins > 2000, r.t.slice(0, 200));
r = await req('POST', '/api/admin/settings', { key: 'drop_fx', value: { ...one("SELECT value FROM settings WHERE key='drop_fx'") && JSON.parse(one("SELECT value FROM settings WHERE key='drop_fx'").value), levels: { rare: 500, epic: 400, legendary: 600, godlike: 700 } } });
check('Админка: неверный порядок порогов кинодропа отклоняется', r.status === 400, r.t.slice(0, 200));

server.close?.();
try { dbm.db.close(); } catch { /* ignore */ }
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\nИтог: ${passed} OK, ${failed} FAIL`);
process.exit(failed ? 1 : 0);
