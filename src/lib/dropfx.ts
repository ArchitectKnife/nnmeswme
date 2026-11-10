// BURGER SKIN — кинематографичные дропы: уровни по стоимости и ссылки «Поделиться дропом».
//
// Честность: уровень (STANDARD / RARE / EPIC / LEGENDARY / GODLIKE) и сцена вычисляются ТОЛЬКО по уже выданному
// предмету и его цене на момент выпадения. Классификация вызывается после выбора предмета в openCase() и
// никак не участвует в выборе: шансы, Provably Fair и выданный предмет остаются прежними.
// Клиент лишь проигрывает анимацию для результата, который сервер уже записал в инвентарь.
import crypto from 'node:crypto';
import { one, all } from './db.ts';
import { getSetting, setSetting, invView, INV_SELECT, publicUser, imageUrl } from './core.ts';

export const FX_LEVELS = ['standard', 'rare', 'epic', 'legendary', 'godlike'] as const;
export type FxLevel = (typeof FX_LEVELS)[number];
export type FxKind = 'knife' | 'glove';
export const FX_LABEL: Record<FxLevel, string> = { standard: 'DROP', rare: 'RARE', epic: 'EPIC', legendary: 'LEGENDARY', godlike: 'GODLIKE' };
// Старые уровни (до v4) хранились в ставках как tier: godlike < mythic < divine. Пороги перенесены один в один.
const LEGACY_TO_LEVEL: Record<string, FxLevel> = { godlike: 'epic', mythic: 'legendary', divine: 'godlike' };
const LEVEL_TO_LEGACY: Partial<Record<FxLevel, string>> = { epic: 'godlike', legendary: 'mythic', godlike: 'divine' };
export const levelIndex = (l: any) => Math.max(0, FX_LEVELS.indexOf(l));

export type DropFx = { level: FxLevel; kind: FxKind | null; scene: FxLevel | FxKind; rank: number; label: string; tier: string | null };

const nameOf = (it: any) => String(it?.name || '');
export const isGlove = (it: any) => it?.category === 'Gloves' || (nameOf(it).startsWith('\u2605') && /gloves|hand wraps/i.test(nameOf(it)));
export const isKnife = (it: any) => !isGlove(it) && (it?.category === 'Knives' || nameOf(it).startsWith('\u2605'));

/** Уровень по стоимости. casePrice нужен только для условия «дроп не дешевле N× цены кейса». */
export function levelFor(price: number, casePrice = 0, s: any = getSetting('drop_fx')): FxLevel {
  const p = Number(price) || 0;
  const L = s.levels || {};
  if (p <= 0) return 'standard';
  if (s.min_x > 0 && casePrice > 0 && p < casePrice * s.min_x) return 'standard';
  if (p >= L.godlike) return 'godlike';
  if (p >= L.legendary) return 'legendary';
  if (p >= L.epic) return 'epic';
  if (p >= L.rare) return 'rare';
  return 'standard';
}

function build(level: FxLevel, kind: FxKind | null): DropFx {
  const word = kind === 'glove' ? 'GLOVES' : kind === 'knife' ? 'KNIFE' : 'DROP';
  const label = level === 'standard' ? word : `${FX_LABEL[level]} ${word}`;
  return { level, kind, scene: kind || level, rank: levelIndex(level) + (kind ? 0.5 : 0), label, tier: LEVEL_TO_LEGACY[level] || null };
}

/** Сцена для выданного предмета или null, если уровень ниже порога запуска сцены (обычный показ в рулетке). */
export function dropFx(item: any, casePrice = 0): DropFx | null {
  const s = getSetting('drop_fx');
  if (!s.enabled || !item) return null;
  let level = levelFor(item.price, casePrice, s);
  const kind: FxKind | null = isGlove(item) ? 'glove' : isKnife(item) ? 'knife' : null;
  const special = kind && s[kind + '_scene'] ? kind : null;
  if (special && levelIndex(level) < levelIndex(s.special_floor)) level = s.special_floor;
  if (levelIndex(level) < levelIndex(s.trigger)) return null;
  return build(level, special);
}

/** Приводит сохранённый в ставке fx (в том числе старого формата tier/scene) к текущему формату. */
export function normalizeFx(fx: any): DropFx | null {
  if (!fx || typeof fx !== 'object') return null;
  const kind: FxKind | null = fx.kind === 'knife' || fx.kind === 'glove' ? fx.kind : fx.scene === 'knife' || fx.scene === 'glove' ? fx.scene : null;
  if (FX_LEVELS.includes(fx.level)) return build(fx.level, kind);
  const level: FxLevel = LEGACY_TO_LEVEL[fx.tier] || (kind ? 'epic' : 'rare');
  return build(level, kind);
}

// ---------- Ссылки «Поделиться дропом» ----------
// Токен = id ставки + HMAC, чтобы по ссылке нельзя было перебрать чужие дропы подряд.
function secret(): string {
  let s = getSetting('share_secret');
  if (typeof s !== 'string' || s.length < 32) { s = crypto.randomBytes(32).toString('hex'); setSetting('share_secret', s); }
  return s;
}
const sig = (id: number) => crypto.createHmac('sha256', secret()).update('drop:' + id).digest('hex').slice(0, 12);
export const shareToken = (betId: number) => `${betId}-${sig(betId)}`;
export const SHARE_RE = /^(\d{1,12})-([a-f0-9]{12})$/;
export function parseShare(token: string): number | null {
  const m = SHARE_RE.exec(String(token || ''));
  if (!m) return null;
  const id = Number(m[1]);
  const a = Buffer.from(sig(id)); const b = Buffer.from(m[2]);
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? id : null;
}

/** Публичная карточка дропа (без приватных данных: только ник, аватар, предмет и хеш Provably Fair). */
export function sharedDrop(betId: number | null) {
  if (!betId) return null;
  const b = one('SELECT b.*, u.nickname, u.avatar, u.role, u.created_at uc FROM bets b JOIN users u ON u.id=b.user_id WHERE b.id=?', betId);
  if (!b || b.game !== 'case') return null;
  let d: any = {};
  try { d = JSON.parse(b.data || '{}'); } catch { d = {}; }
  const row = d.invId ? one(INV_SELECT + ' WHERE inv.id=?', d.invId) : null;
  if (!row) return null;
  const v = invView(row);
  const item = { itemId: v.itemId, name: v.name, weapon: v.weapon, rarityName: v.rarityName, color: v.color, image: v.image, category: v.category, phase: v.phase,
    wear: v.wear, float: v.float, variant: v.variant, stattrak: v.stattrak, souvenir: v.souvenir, price: b.payout, priceNow: v.price };
  const cs = d.caseId ? one('SELECT slug, name, price, status FROM cases WHERE id=?', d.caseId) : null;
  // Уровень, показанный игроку в момент дропа, сохраняется в ставке; для старых ставок — по текущим порогам.
  const fx = d.fx !== undefined ? normalizeFx(d.fx) : dropFx(item, cs?.price || b.amount);
  return {
    token: shareToken(b.id), at: b.created_at, item, fx: fx || null, free: !!d.free,
    user: publicUser({ id: b.user_id, nickname: b.nickname, avatar: b.avatar, role: b.role, created_at: b.uc }),
    case: cs && cs.status === 'published' ? { slug: cs.slug, name: cs.name, price: cs.price } : { slug: null, name: d.caseName || 'Кейс', price: b.amount },
    fair: { serverHash: b.server_hash, nonce: b.nonce },
  };
}

/** Публичная часть настроек для клиента (/api/site). */
export function dropFxPublic() {
  const s = getSetting('drop_fx');
  return { enabled: !!s.enabled, share: !!s.share, defaultMode: s.default_mode, trigger: s.trigger, levels: s.levels, reducedDefault: !!s.reduced_default,
    knifeScene: !!s.knife_scene, gloveScene: !!s.glove_scene, specialFloor: s.special_floor };
}

// ---------- Админка: статистика порогов ----------
const bandSql = 'SELECT COUNT(*) n, COUNT(DISTINCT item_id) items FROM item_prices WHERE price >= ? AND price < ?';
export function dropFxStats(caseDetailFn: (c: any) => any) {
  const s = getSetting('drop_fx');
  const L = s.levels;
  const edges: Array<[FxLevel, number, number]> = [['standard', 1, L.rare], ['rare', L.rare, L.epic], ['epic', L.epic, L.legendary], ['legendary', L.legendary, L.godlike], ['godlike', L.godlike, 1e15]];
  const catalog = Object.fromEntries(edges.map(([k, lo, hi]) => [k, one(bandSql, lo, hi)]));
  // Вероятность каждого уровня сцены по опубликованным кейсам (по шансам и ценам качеств; StatTrak не учитывается).
  const cases = all("SELECT * FROM cases WHERE status='published' ORDER BY price").map((c: any) => {
    const det = caseDetailFn(c);
    const p: Record<string, number> = { rare: 0, epic: 0, legendary: 0, godlike: 0, scene: 0 };
    for (const it of det.items || []) {
      const kind = isGlove(it) ? 'glove' : isKnife(it) ? 'knife' : null;
      for (const w of it.wears || []) {
        const pr = it.chance * (w.p ?? 1);
        let lv = levelFor(w.price, c.price, s);
        if (kind && s[kind + '_scene'] && levelIndex(lv) < levelIndex(s.special_floor)) lv = s.special_floor;
        const i = levelIndex(lv);
        for (const k of ['rare', 'epic', 'legendary', 'godlike'] as const) if (i >= levelIndex(k)) p[k] += pr;
        if (i >= levelIndex(s.trigger)) p.scene += pr;
      }
    }
    return { slug: c.slug, name: c.name, price: c.price, ...p };
  });
  const sample = (lo: number, hi: number, extra = '') => {
    const r = one(`SELECT i.*, p.wear pw, p.variant pv, p.price pp, COALESCE(ii.image, i.image) wimg FROM item_prices p JOIN items i ON i.id=p.item_id
      LEFT JOIN item_images ii ON ii.item_id=i.id AND ii.wear=p.wear WHERE i.archived=0 AND p.price >= ? AND p.price < ? ${extra} ORDER BY p.price DESC LIMIT 1`, lo, hi);
    return r ? { itemId: r.id, name: r.name, weapon: r.weapon, rarityName: r.rarity_name, color: r.rarity_color, image: imageUrl(r.wimg), category: r.category, phase: r.phase,
      wear: r.pw, float: null, variant: r.pv, stattrak: r.pv === 'st', souvenir: r.pv === 'sv', price: r.pp } : null;
  };
  const noSpecial = "AND i.category NOT IN ('Knives','Gloves') AND i.name NOT LIKE '\u2605%'";
  const samples: Record<string, any> = {};
  for (const [k, lo, hi] of edges) samples[k] = sample(lo, hi, noSpecial) || sample(lo, hi);
  samples.knife = sample(L.epic, 1e15, "AND i.category='Knives'") || sample(1, 1e15, "AND i.category='Knives'");
  samples.glove = sample(L.epic, 1e15, "AND i.category='Gloves'") || sample(1, 1e15, "AND i.category='Gloves'");
  return { settings: s, levels: FX_LEVELS, catalog, cases, samples };
}
