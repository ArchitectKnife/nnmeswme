// BURGER SKIN v4: расширенный каталог (фазы Doppler, изображения по качеству, свежие цены) и 47 новых кейсов.
//
//   npm run seed:cases4                    — применить пакет catalog/v4 к базе (повторный запуск ничего не дублирует)
//   npm run seed:cases4 -- --dry-run       — только проверка и отчёт, без записи
//   npm run seed:cases4 -- --refresh-prices    — обновить и уже существующие цены значениями из пакета
//   npm run seed:cases4 -- --update-cases      — пересобрать состав кейсов v4 по пакету (только кейсы source='seed-v4')
//   npm run seed:cases4 -- --keep-local-images — не заменять локальные изображения /img/items/* неизвестного происхождения
//
// Что делает (ничего не удаляет):
//  1. Резервная копия базы (VACUUM INTO data/backups) с проверкой целостности.
//  2. Предметы: добавляет отсутствующие скины из пакета (в т.ч. каждую фазу Doppler/Gamma Doppler отдельным предметом),
//     дополняет пустые поля существующих, привязывает к каждому предмету официальные изображения Steam для каждого качества
//     (item_images). Основное изображение заменяется только если файл отсутствует / изображение не проверено;
//     загруженные администратором (/uploads/...) не трогаются.
//  3. Цены: добавляет отсутствующие цены (источник и время Skinport сохраняются). Существующие — только с --refresh-prices.
//     Цены в инвентаре, ставках и леджере не меняются никогда.
//  4. Кейсы: создаёт новые кейсы v4 с целыми весами (сумма 1 000 000 = ровно 100%), пересчитывает их EV и цену.
//  5. Обложки: каждому кейсу без оформления — своя тема и цвет; одинаковые авто-обложки разных кейсов разводятся.
//  6. Проверяет, что пользователи, балансы, инвентари, ставки и леджер не изменились, и пишет запись в журнал аудита.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { db, one, all, run, tx, now, DATA, ROOT, DB_FILE } from '../src/lib/db.ts';
import { recalcCase } from '../src/lib/cases.ts';
import { audit, setSetting } from '../src/lib/core.ts';
import { COVER_THEMES } from '../src/lib/covers.ts';

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const DRY = flag('--dry-run');
const PKG_DIR = path.join(ROOT, 'catalog', 'v4');
const PUBLIC = path.join(ROOT, 'public');
const TOTAL = 1_000_000;
const MSK = 3 * 3600_000;
const stamp = () => new Date(Date.now() + MSK).toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);

type PkgImage = { src: string; local: string | null; ok: boolean | null } | null;
type PkgItem = {
  key: string; ext_id: string; name: string; phase: string | null; weapon: string | null; category: string | null; pattern: string | null; rarity_id: string | null;
  rarity: string | null; color: string | null; min_float: number; max_float: number; stattrak: boolean; souvenir: boolean; collection: string | null; crates: string[];
  image: PkgImage; wears: Record<string, PkgImage>; prices: Record<string, Record<string, number>>; price_time: number | null; in_cases: boolean;
};

const localExists = (p: string | null | undefined) => !!p && p.startsWith('/') && !p.includes('..') && fs.existsSync(path.join(PUBLIC, p));
/** Локальная копия (если файл на месте), иначе проверенный адрес CDN Steam. */
const pick = (im: PkgImage) => (!im ? null : im.local && localExists(im.local) ? im.local : im.ok === false ? null : im.src);

function tableCounts(d: any): Record<string, number> {
  const out: Record<string, number> = {};
  for (const t of d.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all())
    out[t.name] = Number(d.prepare(`SELECT COUNT(*) n FROM "${String(t.name).replace(/"/g, '""')}"`).get().n);
  return out;
}
const PROTECTED = ['users', 'sessions', 'ledger', 'inventory', 'bets', 'fair_seeds', 'battles', 'battle_players', 'finance_requests', 'tickets', 'ticket_messages', 'friends', 'audit_log'];
function protectedSnapshot() {
  const c = tableCounts(db);
  return {
    counts: Object.fromEntries(PROTECTED.filter((t) => t in c).map((t) => [t, c[t]])),
    balance: Number(one('SELECT COALESCE(SUM(balance),0) s FROM users').s),
    inventory: one("SELECT COALESCE(SUM(price),0) s, COUNT(*) n, COALESCE(SUM(item_id),0) ids, COALESCE(SUM(CASE WHEN status='owned' THEN 1 ELSE 0 END),0) owned FROM inventory"),
    ledger: one('SELECT COALESCE(SUM(amount),0) s, COALESCE(MAX(id),0) m FROM ledger'),
    bets: one('SELECT COALESCE(SUM(amount),0) a, COALESCE(SUM(payout),0) p FROM bets'),
  };
}
function backup() {
  const dir = path.join(DATA, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `burger-${stamp()}-before-v4.sqlite`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const check = String((copy.prepare('PRAGMA quick_check').get() as any).quick_check);
    if (check !== 'ok') throw new Error('резервная копия повреждена: ' + check);
    const a = tableCounts(copy), b = tableCounts(db);
    for (const t of Object.keys(b)) if (a[t] !== b[t]) throw new Error('в резервной копии не совпало число строк в ' + t);
  } finally { copy.close(); }
  return file;
}
const hash = (s: string) => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const WEAR_ORDER = ['FT', 'MW', 'WW', 'FN', 'BS', ''];

export function seedV4(opts: { dry?: boolean; refreshPrices?: boolean; updateCases?: boolean; keepLocalImages?: boolean; log?: (s: string) => void } = {}) {
  const log = opts.log || console.log;
  const pkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'items.json'), 'utf8'));
  const cpkg = JSON.parse(fs.readFileSync(path.join(PKG_DIR, 'cases.json'), 'utf8'));
  const items: PkgItem[] = pkg.items;
  const priceTag: string = pkg.meta.sources.prices.source_tag;
  const t = now();
  const rep = {
    items: { added: 0, phaseAdded: 0, updated: 0, legacyPhaseAssigned: [] as string[], legacyPhaseUnassigned: [] as string[] },
    images: { mainReplaced: [] as Array<{ item: string; from: string | null; to: string; reason: string }>, mainLocalized: 0, wearImages: 0, kept: 0 },
    prices: { added: 0, updated: 0, unchanged: 0 },
    cases: { added: [] as string[], skipped: [] as string[], updated: [] as string[], failed: [] as Array<{ slug: string; error: string }> },
    covers: { themed: 0, deduped: [] as string[] },
  };
  const before = protectedSnapshot();
  const keyToId = new Map<string, number>();

  tx(() => {
    // ---------- 1. Фазы: «склеенная» строка версии ≤3 становится самой дешёвой фазой (цена этой строки = минимум среди фаз) ----------
    const byName = new Map<string, PkgItem[]>();
    for (const it of items) if (it.phase) { if (!byName.has(it.name)) byName.set(it.name, []); byName.get(it.name)!.push(it); }
    for (const [name, phases] of byName) {
      const legacy = all('SELECT * FROM items WHERE name=? COLLATE NOCASE AND phase IS NULL ORDER BY id', name);
      if (!legacy.length) continue;
      const value = (p: PkgItem) => { const v = Object.values(p.prices[''] || {}); return v.length ? Math.min(...v) : Infinity; };
      const free = phases.filter((p) => !one('SELECT 1 FROM items WHERE name=? COLLATE NOCASE AND phase=?', name, p.phase)).sort((a, b) => value(a) - value(b));
      const L = legacy[0];
      if (free.length) {
        const p = free[0];
        const img = pick(p.image);
        run('UPDATE items SET phase=?, ext_id=CASE WHEN EXISTS(SELECT 1 FROM items x WHERE x.ext_id=? AND x.id<>?) THEN ext_id ELSE ? END, updated_at=? WHERE id=?', p.phase, p.ext_id, L.id, p.ext_id, t, L.id);
        if (img && !String(L.image || '').startsWith('/uploads/')) {
          run("UPDATE items SET image=?, image_source=?, image_status='verified', image_checked_at=? WHERE id=?", img, p.image!.src, t, L.id);
          rep.images.mainReplaced.push({ item: p.key, from: L.image, to: img, reason: 'склеенная строка фаз: изображение приведено к фазе, цена которой у неё была' });
        }
        rep.items.legacyPhaseAssigned.push(`${name} → ${p.phase} (#${L.id})`);
      } else rep.items.legacyPhaseUnassigned.push(`${name} (#${L.id})`);
    }

    // ---------- 2. Предметы ----------
    for (const it of items) {
      let row = (it.ext_id && one('SELECT * FROM items WHERE ext_id=?', it.ext_id)) || null;
      if (row && (row.phase || null) !== (it.phase || null)) row = null;
      if (!row) row = it.phase ? one('SELECT * FROM items WHERE name=? COLLATE NOCASE AND phase=? ORDER BY id LIMIT 1', it.name, it.phase)
        : one('SELECT * FROM items WHERE name=? COLLATE NOCASE AND phase IS NULL ORDER BY id LIMIT 1', it.name);
      const main = pick(it.image);
      const crates = it.crates?.length ? JSON.stringify(it.crates) : null;
      if (!row) {
        if (!main) continue; // без проверенного изображения предмет не добавляется
        const id = run(`INSERT INTO items(ext_id,name,weapon,category,pattern,phase,rarity,rarity_name,rarity_color,min_float,max_float,stattrak,souvenir,image,image_source,image_status,image_checked_at,collection,crates,price_source,created_at,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          one('SELECT 1 FROM items WHERE ext_id=?', it.ext_id) ? null : it.ext_id, it.name, it.weapon, it.category, it.pattern, it.phase, it.rarity_id, it.rarity, it.color,
          it.min_float, it.max_float, it.stattrak ? 1 : 0, it.souvenir ? 1 : 0, main, it.image!.src, 'verified', t, it.collection, crates, priceTag, t, t).lastInsertRowid;
        keyToId.set(it.key, Number(id));
        rep.items.added++; if (it.phase) rep.items.phaseAdded++;
        row = one('SELECT * FROM items WHERE id=?', id);
      } else {
        keyToId.set(it.key, row.id);
        run(`UPDATE items SET weapon=COALESCE(weapon, ?), category=COALESCE(category, ?), pattern=COALESCE(pattern, ?), rarity=COALESCE(rarity, ?), rarity_name=COALESCE(rarity_name, ?),
          rarity_color=COALESCE(rarity_color, ?), collection=COALESCE(collection, ?), crates=COALESCE(crates, ?), ext_id=COALESCE(ext_id, CASE WHEN EXISTS(SELECT 1 FROM items x WHERE x.ext_id=?) THEN NULL ELSE ? END) WHERE id=?`,
          it.weapon, it.category, it.pattern, it.rarity_id, it.rarity, it.color, it.collection, crates, it.ext_id, it.ext_id, row.id);
        rep.items.updated++;
        // Основное изображение
        const cur: string = row.image || '';
        const upload = cur.startsWith('/uploads/');
        let next: string | null = null, reason = '';
        if (upload) { rep.images.kept++; }
        else if (!cur) { next = main; reason = 'не было изображения'; }
        else if (cur.startsWith('/')) {
          if (!localExists(cur)) { next = main; reason = 'файл изображения отсутствует'; }
          else if (!cur.startsWith('/img/skins/') && !opts.keepLocalImages) { next = main; reason = 'локальный файл без подтверждённого источника заменён официальным изображением Steam'; }
          else rep.images.kept++;
        } else if (it.image && cur === it.image.src) {
          if (main && main !== cur) { next = main; reason = 'локальная копия того же изображения'; rep.images.mainLocalized++; }
          else rep.images.kept++;
        } else rep.images.kept++;
        if (next && next !== cur) {
          run("UPDATE items SET image=?, image_source=?, image_status='verified', image_checked_at=?, updated_at=? WHERE id=?", next, it.image!.src, t, t, row.id);
          if (reason !== 'локальная копия того же изображения') rep.images.mainReplaced.push({ item: it.key, from: cur || null, to: next, reason });
        } else if (!upload && cur && (cur === it.image?.src || cur === it.image?.local)) {
          run("UPDATE items SET image_source=?, image_status='verified', image_checked_at=? WHERE id=?", it.image!.src, t, row.id);
        }
      }
      // Изображения по качеству (для предметов с загруженной вручную картинкой не подставляем)
      if (!String(row.image || '').startsWith('/uploads/')) {
        for (const [w, im] of Object.entries(it.wears || {})) {
          const img = pick(im);
          if (!img) continue;
          run('INSERT INTO item_images(item_id,wear,image,source,verified_at) VALUES(?,?,?,?,?) ON CONFLICT(item_id,wear) DO UPDATE SET image=excluded.image, source=excluded.source, verified_at=excluded.verified_at',
            row.id, w, img, im!.src, t);
          rep.images.wearImages++;
        }
      }
      // ---------- 3. Цены ----------
      const pt = it.price_time || t;
      let touched = false;
      for (const [variant, byWear] of Object.entries(it.prices || {})) for (const [wear, kop] of Object.entries(byWear)) {
        if (!(kop > 0)) continue;
        const ex = one('SELECT price FROM item_prices WHERE item_id=? AND wear=? AND variant=?', row.id, wear, variant);
        if (!ex) { run('INSERT INTO item_prices(item_id,wear,variant,price,source,updated_at) VALUES(?,?,?,?,?,?)', row.id, wear, variant, kop, priceTag, pt); rep.prices.added++; touched = true; }
        else if (opts.refreshPrices && ex.price !== kop) { run('UPDATE item_prices SET price=?, source=?, updated_at=? WHERE item_id=? AND wear=? AND variant=?', kop, priceTag, pt, row.id, wear, variant); rep.prices.updated++; touched = true; }
        else rep.prices.unchanged++;
      }
      if (touched || row.base_price == null) {
        const p = one("SELECT price, source FROM item_prices WHERE item_id=? AND variant='' ORDER BY CASE wear WHEN 'FT' THEN 0 WHEN '' THEN 0 WHEN 'MW' THEN 1 WHEN 'WW' THEN 2 WHEN 'FN' THEN 3 ELSE 4 END LIMIT 1", row.id);
        if (p) run('UPDATE items SET base_price=?, price_source=? WHERE id=?', p.price, p.source, row.id);
      }
    }

    // ---------- 4. Кейсы ----------
    let sort = Number(one('SELECT COALESCE(MAX(sort),0) m FROM cases').m) + 1;
    for (const c of cpkg.cases) {
      try {
        const ex = one('SELECT * FROM cases WHERE slug=?', c.slug);
        if (ex && !(opts.updateCases && ex.source === 'seed-v4')) { rep.cases.skipped.push(c.slug); continue; }
        const rows = c.items.map((x: any) => ({ id: keyToId.get(x.key), weight: x.weight, key: x.key }));
        const miss = rows.filter((r: any) => !r.id || !one('SELECT 1 FROM items WHERE id=? AND archived=0', r.id));
        if (miss.length) throw new Error('нет предметов: ' + miss.map((m: any) => m.key).join(', '));
        const sum = rows.reduce((s: number, r: any) => s + r.weight, 0);
        if (sum !== TOTAL || rows.some((r: any) => !(Number.isInteger(r.weight) && r.weight > 0))) throw new Error('веса не дают ровно 100%');
        // Каждый предмет должен иметь цену для всех возможных качеств (иначе кейс не публикуется)
        const cover = JSON.stringify(c.cover.map((k: string) => keyToId.get(k)).filter(Boolean));
        let id: number;
        if (ex) {
          id = ex.id;
          run('UPDATE cases SET name=?, description=?, categories=?, featured=?, cover_theme=?, accent=?, cover_mode=?, cover_items=?, updated_at=? WHERE id=?',
            c.name, c.description, JSON.stringify(c.categories), c.featured ? 1 : 0, c.theme, c.accent, 'auto', cover, t, id);
          run('DELETE FROM case_items WHERE case_id=?', id);
          rep.cases.updated.push(c.slug);
        } else {
          id = Number(run(`INSERT INTO cases(slug,name,description,image,price,price_mode,categories,status,sort,source,created_at,updated_at,cover_mode,cover_items,featured,cover_theme,accent)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, c.slug, c.name, c.description, '', 100, 'auto', JSON.stringify(c.categories), 'published', sort++, 'seed-v4', t, t, 'auto', cover,
            c.featured ? 1 : 0, c.theme, c.accent).lastInsertRowid);
          rep.cases.added.push(c.slug);
        }
        for (const r of rows) run('INSERT INTO case_items(case_id,item_id,weight) VALUES(?,?,?)', id, r.id, r.weight);
        recalcCase(id);
      } catch (e: any) { rep.cases.failed.push({ slug: c.slug, error: String(e.message || e) }); }
    }

    // ---------- 5. Оформление обложек существующих кейсов ----------
    const themes = Object.keys(COVER_THEMES);
    const taken = new Set(all("SELECT cover_theme || '|' || lower(accent) k FROM cases WHERE cover_theme IS NOT NULL AND accent IS NOT NULL").map((r: any) => r.k));
    for (const c of all("SELECT * FROM cases WHERE status<>'archived' AND (cover_theme IS NULL OR accent IS NULL) ORDER BY id")) {
      let h = hash(c.slug), theme = '', accent = '';
      for (let k = 0; k < 64; k++, h = hash(String(h))) {
        theme = c.cover_theme || themes[h % themes.length];
        accent = c.accent || hsl((h >>> 8) % 360, 72, 62);
        if (!taken.has(theme + '|' + accent.toLowerCase())) break;
      }
      taken.add(theme + '|' + accent.toLowerCase());
      run('UPDATE cases SET cover_theme=?, accent=? WHERE id=?', theme, accent, c.id);
      rep.covers.themed++;
    }
    // Одинаковые авто-обложки (те же 3 предмета) у разных кейсов: берём следующие по цене предметы этого кейса.
    const sig = new Map<string, number>();
    for (const c of all("SELECT * FROM cases WHERE status<>'archived' ORDER BY (source='seed-v4') DESC, opens DESC, id")) {
      if (c.cover_mode === 'image' && c.image && !/^\/img\/cases\//.test(c.image)) continue;
      let ids: number[] = [];
      try { ids = JSON.parse(c.cover_items || '[]'); } catch { ids = []; }
      const pool = all('SELECT i.id FROM case_items ci JOIN items i ON i.id=ci.item_id WHERE ci.case_id=? ORDER BY COALESCE(i.base_price,0) DESC', c.id).map((r: any) => Number(r.id));
      if (!ids.length) ids = pool.slice(0, 3);
      let key = [...ids].sort((a, b) => a - b).join(',');
      if (sig.has(key) && pool.length > 3) {
        for (let off = 1; off + 3 <= pool.length; off++) {
          const alt = [pool[0], ...pool.slice(off, off + 2)].filter((x, i, a) => a.indexOf(x) === i);
          const k2 = [...alt].sort((a, b) => a - b).join(',');
          if (!sig.has(k2)) { ids = alt; key = k2; run('UPDATE cases SET cover_items=? WHERE id=?', JSON.stringify(ids), c.id); rep.covers.deduped.push(c.slug); break; }
        }
      }
      sig.set(key, c.id);
    }
    if (opts.dry) throw new DryRun();
  });

  const after = protectedSnapshot();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Проверка сохранности не пройдена: изменились данные пользователей. Транзакция уже применена — восстановите резервную копию.');
  return { rep, protected: after };
}
class DryRun extends Error { constructor() { super('dry-run'); } }
function hsl(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n: number) => { const k = (n + h / 30) % 12; const c = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round(c * 255).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isMain) {
  try {
    console.log('База:', DB_FILE, DRY ? '[пробный запуск]' : '');
    let file = '';
    if (!DRY && !flag('--no-backup')) { file = backup(); console.log('Резервная копия:', file); }
    let res: any;
    try { res = seedV4({ dry: DRY, refreshPrices: flag('--refresh-prices'), updateCases: flag('--update-cases'), keepLocalImages: flag('--keep-local-images') }); }
    catch (e) { if (e instanceof DryRun) { console.log('Пробный запуск: изменения откатились.'); process.exit(0); } throw e; }
    const r = res.rep;
    const summary = { items: { ...r.items, legacyPhaseAssigned: r.items.legacyPhaseAssigned.length }, images: { ...r.images, mainReplaced: r.images.mainReplaced.length }, prices: r.prices,
      cases: { added: r.cases.added.length, skipped: r.cases.skipped.length, updated: r.cases.updated.length, failed: r.cases.failed }, covers: { themed: r.covers.themed, deduped: r.covers.deduped.length } };
    console.log(JSON.stringify(summary, null, 1));
    const out = path.join(DATA, 'catalog', `seed-v4-report-${stamp()}.json`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify({ backup: file, ...r }, null, 1));
    console.log('Полный отчёт:', out);
    setSetting('catalog_v4', { at: now(), ...summary });
    audit(null, 'catalog.v4', 'catalog', null, summary, 'cli');
    console.log('Проверка сохранности: пользователи, балансы, инвентари, ставки и леджер не изменились.');
  } catch (e: any) { console.error('Ошибка:', e.message); process.exit(1); }
}
