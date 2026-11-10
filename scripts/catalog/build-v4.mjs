// BURGER SKIN v4 — сборка пакета каталога и новых кейсов (инструмент сопровождающего, нужен интернет и Python + Pillow).
//
//   node scripts/catalog/build-v4.mjs --prices data/prices-rub.json [--python python3] [--quality 82] [--skip-images]
//
// Источники (ничего не придумывается):
//  • предметы, редкость, float, коллекции и изображения по каждому качеству — ByMykel CSGO-API (MIT; данные из файлов игры,
//    изображения — официальный CDN Steam community.akamai.steamstatic.com);
//  • цены — выгрузка Skinport API в рублях (suggested_price; дата обновления каждой цены сохраняется).
// Результат:
//  • catalog/v4/items.json — все скины CS2 из источника (включая фазы Doppler) с ценами и изображениями по качеству;
//  • catalog/v4/cases.json — новые кейсы: состав, целые веса (сумма ровно 1 000 000 = 100%), обложки, категории;
//  • public/img/skins/<предмет>/<качество>.webp — локальные копии проверенных изображений предметов из новых кейсов;
//  • catalog/v4/build-report.json — отчёт: что не найдено, проверка изображений, дубли.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CASES, CATEGORIES } from './cases-v4.def.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes(n);
const PRICES = path.resolve(opt('--prices', 'data/prices-rub.json'));
const PY = opt('--python', 'python3');
const QUALITY = Number(opt('--quality', 82));
const CACHE = path.join(ROOT, 'data', 'catalog');
const OUT = path.join(ROOT, 'catalog', 'v4');
const IMG_DIR = path.join(ROOT, 'public', 'img', 'skins');
const TMP = path.join(ROOT, 'data', 'catalog', 'img-src');
const MARGIN = 0.12; // economy.case_margin по умолчанию: цена auto = EV × 1.12
const TOTAL = 1_000_000; // сумма весов кейса = 100.0000%
const ST_CHANCE = 0.1;
const BYMYKEL = 'https://raw.githubusercontent.com/ByMykel/CSGO-API/main/public/api/en/';
fs.mkdirSync(CACHE, { recursive: true }); fs.mkdirSync(OUT, { recursive: true }); fs.mkdirSync(TMP, { recursive: true });

async function source(name) {
  const file = path.join(CACHE, name);
  if (!flag('--refresh') && fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < 3 * 86400_000) return { data: JSON.parse(fs.readFileSync(file, 'utf8')), fetched: fs.statSync(file).mtime.toISOString() };
  const r = await fetch(BYMYKEL + name, { headers: { 'User-Agent': 'BURGER-SKIN-catalog-builder' } });
  if (!r.ok) throw new Error(name + ': HTTP ' + r.status);
  const text = await r.text();
  fs.writeFileSync(file, text);
  return { data: JSON.parse(text), fetched: new Date().toISOString() };
}

const WEAR = { 'Factory New': 'FN', 'Minimal Wear': 'MW', 'Field-Tested': 'FT', 'Well-Worn': 'WW', 'Battle-Scarred': 'BS' };
const WEARS = [['FN', 0, 0.07], ['MW', 0.07, 0.15], ['FT', 0.15, 0.38], ['WW', 0.38, 0.45], ['BS', 0.45, 1.01]];
const keyOf = (name, phase) => name + (phase ? ' @ ' + phase : '');
const slug = (s) => s.toLowerCase().replace(/★/g, '').replace(/™/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .replace(/[^a-z0-9\u3040-\u30ff\u4e00-\u9fff]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70);
function parseMarket(m) {
  let s = m.trim(), star = '', variant = '';
  if (s.startsWith('★ ')) { star = '★ '; s = s.slice(2); }
  if (s.startsWith('StatTrak™ ')) { variant = 'st'; s = s.slice(10); } else if (s.startsWith('Souvenir ')) { variant = 'sv'; s = s.slice(9); }
  let wear = '';
  const w = / \(([^)]+)\)$/.exec(s);
  if (w && WEAR[w[1]]) { wear = WEAR[w[1]]; s = s.slice(0, w.index); }
  return { name: star + s, wear, variant };
}
// Как normalizeItem() в src/lib/catalog.ts: у ножей и перчаток редкость «Extraordinary» и золотой цвет.
const RARITY_COLORS = { 'Consumer Grade': '#b0c3d9', 'Industrial Grade': '#5e98d9', 'Mil-Spec Grade': '#4b69ff', Restricted: '#8847ff', Classified: '#d32ce6', Covert: '#eb4b4b', Extraordinary: '#e4ae39', Contraband: '#e4ae39' };

function wearOdds(b) {
  if (!b.wears.length) return [['', 1]];
  const span = b.maxf - b.minf;
  return WEARS.map(([w, lo, hi]) => [w, Math.max(0, Math.min(b.maxf, hi) - Math.max(b.minf, lo)) / span]).filter(([, p]) => p > 0);
}
/** Стоимость предмета для кейса, как itemEV() на сервере: средняя по качествам, StatTrak с шансом 10%. 0 — нет полной цены. */
function caseValue(b) {
  const odds = wearOdds(b);
  const avg = (v) => { let s = 0; for (const [w, p] of odds) { const x = b.prices[v][w]; if (!x) return 0; s += p * x; } return s; };
  const base = avg('');
  if (!base) return 0;
  if (!b.st) return base;
  const st = avg('st');
  return st ? base * (1 - ST_CHANCE) + st * ST_CHANCE : 0;
}

async function pool(list, n, fn) { let i = 0; const out = []; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } })); return out; }

async function main() {
  const t0 = Date.now();
  const [sk, ng] = [await source('skins.json'), await source('skins_not_grouped.json')];
  const sp = JSON.parse(fs.readFileSync(PRICES, 'utf8'));
  console.log(`ByMykel: ${sk.data.length} скинов, ${ng.data.length} вариантов; Skinport: ${sp.length} записей`);

  // ---------- цены ----------
  const price = new Map();
  let pMin = Infinity, pMax = 0;
  for (const r of sp) {
    if (r.currency !== 'RUB') continue;
    const v = r.suggested_price ?? r.median_price ?? r.min_price ?? r.mean_price;
    if (!(v > 0)) continue;
    const p = parseMarket(r.market_hash_name);
    price.set(`${p.name}|${r.version || ''}|${p.wear}|${p.variant}`, { kop: Math.round(v * 100), t: r.updated_at * 1000 });
    if (r.updated_at) { pMin = Math.min(pMin, r.updated_at * 1000); pMax = Math.max(pMax, r.updated_at * 1000); }
  }
  // ---------- изображения по качеству ----------
  const wimg = new Map();
  for (const e of ng.data) {
    const w = WEAR[e.wear?.name] || '';
    if (!wimg.has(e.skin_id)) wimg.set(e.skin_id, {});
    const m = wimg.get(e.skin_id);
    if (e.image && !m[w]) m[w] = e.image;
  }
  // ---------- книга предметов ----------
  const book = new Map();
  for (const s of sk.data) {
    const phase = s.phase || null;
    const wears = (s.wears || []).map((w) => WEAR[w.name]).filter(Boolean);
    const prices = { '': {}, st: {}, sv: {} };
    const ptime = {};
    for (const v of ['', 'st', 'sv']) for (const w of wears.length ? wears : ['']) {
      const x = price.get(`${s.name}|${phase || ''}|${w}|${v}`);
      if (x) { prices[v][w] = x.kop; ptime[v + w] = x.t; }
    }
    const star = s.name.startsWith('★');
    let rarity = s.rarity?.name || null;
    if (star && (rarity === 'Covert' || !rarity)) rarity = 'Extraordinary';
    const b = {
      key: keyOf(s.name, phase), ext_id: s.id, name: s.name, phase, weapon: s.weapon?.name || null, category: s.category?.name || null, pattern: s.pattern?.name || null,
      rarity_id: s.rarity?.id || null, rarity, color: star ? RARITY_COLORS.Extraordinary : s.rarity?.color || RARITY_COLORS[rarity] || null,
      minf: s.min_float ?? 0, maxf: s.max_float ?? 1, st: !!s.stattrak, sv: !!s.souvenir, paint: s.paint_index || null,
      collection: s.collections?.[0]?.name || null, crates: (s.crates || []).map((c) => c.name),
      src: s.image || null, wsrc: wimg.get(s.id) || {}, wears, prices, ptime,
    };
    // Без износа (ванильные ножи) — одно изображение и цена без качества.
    if (!wears.length && b.src) b.wsrc = { '': b.src };
    b.value = caseValue(b);
    if (book.has(b.key)) console.warn('Дубль ключа в источнике:', b.key);
    book.set(b.key, b);
  }
  const all = [...book.values()];
  console.log(`Предметов: ${all.length}, с полной ценой: ${all.filter((b) => b.value > 0).length}`);

  // ---------- кейсы ----------
  const report = { unresolved: [], dropped: [], cases: [] };
  const used = new Set();
  const resolved = [];
  const accents = new Set();
  for (const d of CASES) {
    if (accents.has(d.accent.toLowerCase())) throw new Error('Цвет кейса повторяется: ' + d.slug);
    accents.add(d.accent.toLowerCase());
    const picked = new Map();
    // Предметы обложки всегда входят в кейс (если у них есть полная цена и изображение).
    const named = [...new Set([...(d.items || []), ...(d.cover || [])])];
    for (const name of named) {
      const [n, ph] = name.split(' @ ');
      const b = book.get(keyOf(n, ph || null));
      if (!b) { report.unresolved.push({ case: d.slug, item: name, reason: 'нет в ByMykel' }); continue; }
      if (!b.value) { report.dropped.push({ case: d.slug, item: name, reason: 'нет полной цены (все качества' + (b.st ? ' и StatTrak' : '') + ')' }); continue; }
      if (!b.src) { report.dropped.push({ case: d.slug, item: name, reason: 'нет изображения' }); continue; }
      picked.set(b.key, b);
    }
    for (const fill of Array.isArray(d.fill) ? d.fill : d.fill ? [d.fill] : []) {
      const lo = (fill.min ?? 0) * 100, hi = (fill.max ?? 1e9) * 100;
      const cand = all.filter((b) => b.value > 0 && b.src && b.value >= lo && b.value <= hi && !picked.has(b.key) && (() => { try { return fill.where(b); } catch { return false; } })())
        .sort((a, z) => a.value - z.value);
      const weapons = new Set(cand.map((b) => b.weapon));
      const cap = weapons.size >= 4 ? Math.max(2, Math.ceil(fill.count / 4)) : Infinity;
      const perW = new Map();
      for (const b of picked.values()) perW.set(b.weapon, (perW.get(b.weapon) || 0) + 1);
      const L0 = Math.log(cand[0]?.value || 1), L1 = Math.log(cand[cand.length - 1]?.value || 1);
      const take = Math.min(fill.count, cand.length);
      for (let k = 0; k < take; k++) {
        const target = Math.exp(L0 + ((k + 0.5) / take) * (L1 - L0));
        let best = null, bd = Infinity;
        for (const b of cand) {
          if (picked.has(b.key) || (perW.get(b.weapon) || 0) >= cap) continue;
          const dd = Math.abs(Math.log(b.value) - Math.log(target));
          if (dd < bd) { bd = dd; best = b; }
        }
        if (!best) break;
        picked.set(best.key, best); perW.set(best.weapon, (perW.get(best.weapon) || 0) + 1);
      }
    }
    const items = [...picked.values()].sort((a, z) => z.value - a.value);
    if (items.length < 6) throw new Error(`Кейс ${d.slug}: слишком мало предметов (${items.length})`);
    // Кривая шансов: вес ∝ стоимость^-α, α подбирается под желаемую цену.
    const evAt = (a) => { let sw = 0, sv = 0; for (const b of items) { const w = Math.pow(b.value, -a); sw += w; sv += w * b.value; } return sv / sw; };
    const want = (d.target * 100) / (1 + MARGIN);
    let a0 = 0, a1 = 4, alpha;
    if (want >= evAt(0)) alpha = 0; else if (want <= evAt(4)) alpha = 4;
    else { for (let i = 0; i < 80; i++) { const m = (a0 + a1) / 2; if (evAt(m) > want) a0 = m; else a1 = m; } alpha = (a0 + a1) / 2; }
    const raw = items.map((b) => Math.pow(b.value, -alpha));
    const rs = raw.reduce((s, x) => s + x, 0);
    const exact = raw.map((x) => (x / rs) * TOTAL);
    const w = exact.map((x) => Math.max(1, Math.floor(x)));
    let diff = TOTAL - w.reduce((s, x) => s + x, 0);
    const order = exact.map((x, i) => [x - Math.floor(x), i]).sort((p, q) => q[0] - p[0]);
    for (let k = 0; diff > 0; k = (k + 1) % order.length, diff--) w[order[k][1]]++;
    while (diff < 0) { const i = w.indexOf(Math.max(...w)); w[i]--; diff++; }
    if (w.reduce((s, x) => s + x, 0) !== TOTAL) throw new Error('Сумма весов не 100%: ' + d.slug);
    const ev = items.reduce((s, b, i) => s + (w[i] / TOTAL) * b.value, 0);
    let cover = (d.cover?.length ? d.cover.map((n) => { const [x, ph] = n.split(' @ '); return keyOf(x, ph || null); }) : []).filter((k) => {
      if (picked.has(k)) return true;
      report.dropped.push({ case: d.slug, item: k, reason: 'обложка: предмета нет в кейсе' });
      return false;
    });
    for (const b of items) if (cover.length < 3 && !cover.includes(b.key)) cover.push(b.key);
    const byR = {};
    items.forEach((b, i) => { byR[b.rarity] = (byR[b.rarity] || 0) + w[i] / TOTAL; });
    for (const b of items) used.add(b.key);
    resolved.push({ slug: d.slug, name: d.name, description: d.description, group: d.group, categories: [...new Set([d.group, ...(d.tags || [])])], featured: !!d.featured,
      theme: d.theme, accent: d.accent, cover, items: items.map((b, i) => ({ key: b.key, weight: w[i] })) });
    report.cases.push({ slug: d.slug, items: items.length, alpha: Math.round(alpha * 1000) / 1000, targetRub: d.target, evRub: Math.round(ev) / 100, priceRub: Math.round(ev * (1 + MARGIN)) / 100,
      topChance: Math.max(...w) / TOTAL, minChance: Math.min(...w) / TOTAL, rarities: byR });
  }

  // ---------- изображения ----------
  // Локально сохраняем все качества предметов из новых кейсов; остальные адреса проверяем запросом к CDN.
  const localJobs = new Map(); // url -> { item, wear, dst }
  for (const k of used) {
    const b = book.get(k);
    const dir = slug(b.name) + (b.phase ? '-' + slug(b.phase) : '');
    const seen = new Map();
    const entries = Object.entries(b.wsrc).length ? Object.entries(b.wsrc) : [['', b.src]];
    for (const [w, url] of [...entries, ['main', b.src]]) {
      if (!url || seen.has(url) || localJobs.has(url)) continue;
      const file = `${dir}/${(w || 'main').toLowerCase()}.webp`;
      seen.set(url, file);
      localJobs.set(url, { key: k, file });
    }
  }
  const verify = new Map(); // url -> { ok, status, type, bytes?, local? }
  const imgKey = (u) => crypto.createHash('sha1').update(u).digest('hex').slice(0, 16);
  if (!flag('--skip-images')) {
    const jobs = [...localJobs.entries()];
    console.log(`Загрузка изображений для новых кейсов: ${jobs.length}`);
    const tsv = [];
    await pool(jobs, 12, async ([url, j]) => {
      const tmp = path.join(TMP, imgKey(url) + '.png');
      const dst = path.join(IMG_DIR, j.file);
      if (fs.existsSync(dst)) { verify.set(url, { ok: true, status: 200, type: 'image/webp', local: '/img/skins/' + j.file }); return; }
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          if (!fs.existsSync(tmp)) {
            const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
            const type = r.headers.get('content-type') || '';
            const buf = Buffer.from(await r.arrayBuffer());
            if (!r.ok || !/^image\/png/.test(type) || buf.readUInt32BE(0) !== 0x89504e47) { verify.set(url, { ok: false, status: r.status, type }); return; }
            fs.writeFileSync(tmp, buf);
          }
          tsv.push(`${tmp}\t${dst}`);
          verify.set(url, { ok: true, status: 200, type: 'image/png', local: '/img/skins/' + j.file });
          return;
        } catch (e) { if (attempt === 2) verify.set(url, { ok: false, status: 0, error: String(e.message || e) }); }
      }
    });
    if (tsv.length) {
      const list = path.join(TMP, 'convert.tsv');
      fs.writeFileSync(list, tsv.join('\n'));
      const r = spawnSync(PY, [path.join(ROOT, 'scripts', 'catalog', 'webp.py'), list, String(QUALITY)], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
      if (r.status !== 0) throw new Error('webp.py: ' + (r.stderr || r.error));
      for (const line of r.stdout.split('\n')) if (line.startsWith('ERR\t')) { const dst = line.split('\t')[1]; for (const [u, v] of verify) if (v.local && path.join(ROOT, 'public', v.local) === dst) verify.set(u, { ok: false, status: 0, error: 'convert' }); }
      console.log('WebP:', r.stdout.trim().split('\n').pop());
    }
    // Проверка остальных адресов (HEAD; при отказе — GET).
    const rest = [...new Set(all.flatMap((b) => [b.src, ...Object.values(b.wsrc)]).filter((u) => u && !verify.has(u)))];
    console.log(`Проверка остальных изображений на CDN Steam: ${rest.length}`);
    let n = 0;
    await pool(rest, 24, async (url) => {
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          let r = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
          if (!r.ok) r = await fetch(url, { signal: AbortSignal.timeout(20000) });
          const type = r.headers.get('content-type') || '';
          verify.set(url, { ok: r.ok && /^image\//.test(type), status: r.status, type });
          break;
        } catch (e) { if (attempt === 2) verify.set(url, { ok: false, status: 0, error: String(e.message || e) }); }
      }
      if (++n % 1000 === 0) console.log(`  ${n}/${rest.length}`);
    });
  }

  // ---------- запись пакета ----------
  const pkgItems = all.map((b) => {
    const im = (u) => (u ? { src: u, local: verify.get(u)?.local || null, ok: verify.has(u) ? !!verify.get(u).ok : null } : null);
    const wears = {};
    for (const [w, u] of Object.entries(b.wsrc)) wears[w] = im(u);
    return { key: b.key, ext_id: b.ext_id, name: b.name, phase: b.phase, weapon: b.weapon, category: b.category, pattern: b.pattern, rarity_id: b.rarity_id, rarity: b.rarity,
      color: b.color, min_float: b.minf, max_float: b.maxf, stattrak: b.st, souvenir: b.sv, paint_index: b.paint, collection: b.collection, crates: b.crates,
      image: im(b.src), wears, prices: b.prices, price_time: Object.keys(b.ptime).length ? Math.max(...Object.values(b.ptime)) : null, in_cases: used.has(b.key) };
  });
  const meta = {
    built_at: new Date().toISOString(), version: 4,
    sources: {
      items: { name: 'ByMykel CSGO-API (MIT)', url: BYMYKEL + 'skins.json', variants: BYMYKEL + 'skins_not_grouped.json', fetched: sk.fetched },
      images: { name: 'Steam Community CDN (official item images)', host: 'community.akamai.steamstatic.com' },
      prices: { name: 'Skinport API, suggested_price', currency: 'RUB', file: path.basename(PRICES), updated_from: new Date(Number.isFinite(pMin) ? pMin : pMax).toISOString(), updated_to: new Date(pMax).toISOString(), source_tag: 'skinport:' + new Date(pMax).toISOString().slice(0, 10) },
    },
    weights_total: TOTAL, margin: MARGIN,
  };
  fs.writeFileSync(path.join(OUT, 'items.json'), JSON.stringify({ meta, items: pkgItems }));
  fs.writeFileSync(path.join(OUT, 'cases.json'), JSON.stringify({ meta, categories: CATEGORIES, cases: resolved }, null, 1));

  // ---------- отчёт ----------
  const byUrl = new Map();
  for (const b of all) for (const u of new Set([b.src, ...Object.values(b.wsrc)])) { if (!u) continue; if (!byUrl.has(u)) byUrl.set(u, new Set()); byUrl.get(u).add(b.key); }
  const dupes = [...byUrl.entries()].filter(([, s]) => s.size > 1).map(([u, s]) => ({ url: u, items: [...s] }));
  const failed = [...verify.entries()].filter(([, v]) => !v.ok).map(([u, v]) => ({ url: u, ...v, items: [...(byUrl.get(u) || [])] }));
  const usedItems = [...used].map((k) => book.get(k));
  const rep = {
    ...meta, took_s: Math.round((Date.now() - t0) / 1000),
    totals: { items: all.length, priced: all.filter((b) => b.value > 0).length, phaseItems: all.filter((b) => b.phase).length, caseItems: used.size, cases: resolved.length },
    images: { urls: byUrl.size, verified: [...verify.values()].filter((v) => v.ok).length, failed: failed.length, local: [...verify.values()].filter((v) => v.ok && v.local).length,
      itemsWithoutImage: all.filter((b) => !b.src).map((b) => b.key), caseItemsWithoutLocal: usedItems.filter((b) => !verify.get(b.src)?.local).map((b) => b.key) },
    duplicateImageAssignments: dupes, failedImages: failed.slice(0, 200), ...report,
  };
  fs.writeFileSync(path.join(OUT, 'build-report.json'), JSON.stringify(rep, null, 1));
  console.log(JSON.stringify({ totals: rep.totals, images: { ...rep.images, itemsWithoutImage: rep.images.itemsWithoutImage.length, caseItemsWithoutLocal: rep.images.caseItemsWithoutLocal.length }, dupes: dupes.length, unresolved: report.unresolved, dropped: report.dropped }, null, 1));
  for (const c of report.cases) console.log(`${c.slug.padEnd(18)} n=${String(c.items).padStart(2)} α=${c.alpha.toFixed(2)} target ${c.targetRub} → price ${c.priceRub} (EV ${c.evRub}) top ${(c.topChance * 100).toFixed(2)}% min ${(c.minChance * 100).toFixed(4)}%`);
}
main().catch((e) => { console.error('Ошибка сборки:', e.stack || e.message); process.exit(1); });
