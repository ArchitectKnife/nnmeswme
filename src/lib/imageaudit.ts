// Аудит изображений: каждый скин и каждый кейс должны показывать настоящее, проверенное изображение CS2.
// Офлайн-проверка (быстрая, для админки): локальные файлы существуют, внешние адреса — только CDN Steam, нет заглушек,
// нет одного изображения у разных скинов, у каждого кейса есть обложка из проверенных предметов и она уникальна.
// Онлайн-проверка (CLI --online): дополнительно запрашивает каждый внешний адрес.
import fs from 'node:fs';
import path from 'node:path';
import { all, one, ROOT, DATA } from './db.ts';
import { caseCover } from './cases.ts';

const PUBLIC = path.join(ROOT, 'public');
const STEAM_HOSTS = new Set(['community.akamai.steamstatic.com', 'community.cloudflare.steamstatic.com', 'steamcommunity-a.akamaihd.net', 'steamcdn-a.akamaihd.net', 'cdn.steamstatic.com']);
const PLACEHOLDER = /^\/img\/(brand|cases)\//;

export type ImgCheck = { ok: boolean; kind: 'local' | 'steam' | 'upload' | 'other' | 'none'; reason?: string };
export function checkImage(src: string | null | undefined): ImgCheck {
  if (!src) return { ok: false, kind: 'none', reason: 'нет изображения' };
  if (src.startsWith('/')) {
    if (PLACEHOLDER.test(src)) return { ok: false, kind: 'local', reason: 'заглушка вместо изображения' };
    const kind = src.startsWith('/uploads/') ? 'upload' : 'local';
    const file = kind === 'upload' ? path.join(DATA, 'uploads', src.slice('/uploads/'.length)) : path.join(PUBLIC, src);
    if (src.includes('..') || !fs.existsSync(file)) return { ok: false, kind, reason: 'файл не найден' };
    return { ok: true, kind };
  }
  try {
    const u = new URL(src);
    if (u.protocol === 'https:' && STEAM_HOSTS.has(u.hostname)) return { ok: true, kind: 'steam' };
    return { ok: false, kind: 'other', reason: 'адрес не с CDN Steam' };
  } catch { return { ok: false, kind: 'other', reason: 'некорректный адрес' }; }
}

export function imageAudit(o: { limit?: number } = {}) {
  const limit = o.limit ?? 200;
  const items = all('SELECT id, name, phase, image, image_status, image_source, archived FROM items WHERE archived=0 ORDER BY id');
  const missing: any[] = [], unverified: any[] = [];
  let verified = 0, local = 0, remote = 0;
  const byImage = new Map<string, Set<string>>();
  const label = (r: any) => r.name + (r.phase ? ` (${r.phase})` : '');
  const addUse = (img: string, who: string) => { if (!byImage.has(img)) byImage.set(img, new Set()); byImage.get(img)!.add(who); };
  for (const r of items) {
    const c = checkImage(r.image);
    if (!c.ok) { missing.push({ id: r.id, name: label(r), image: r.image, reason: c.reason }); continue; }
    if (c.kind === 'local' || c.kind === 'upload') local++; else remote++;
    // Проверенным считается изображение из официального источника (CDN Steam или его локальная копия) либо загрузка администратора.
    if (r.image_status === 'verified' || c.kind === 'steam' || c.kind === 'upload' || r.image.startsWith('/img/skins/')) verified++;
    else unverified.push({ id: r.id, name: label(r), image: r.image, reason: 'источник изображения не подтверждён' });
    addUse(r.image, label(r));
  }
  const wear = all('SELECT ii.item_id, ii.wear, ii.image, i.name, i.phase FROM item_images ii JOIN items i ON i.id=ii.item_id WHERE i.archived=0');
  const brokenWear: any[] = [];
  for (const w of wear) {
    const c = checkImage(w.image);
    if (!c.ok) brokenWear.push({ id: w.item_id, name: label(w), wear: w.wear, image: w.image, reason: c.reason });
    addUse(w.image, label(w));
  }
  const duplicates = [...byImage.entries()].filter(([, s]) => s.size > 1).map(([image, s]) => ({ image, items: [...s] }));

  const cases = all("SELECT * FROM cases WHERE status<>'archived' ORDER BY id");
  const coverProblems: any[] = [];
  const sigs = new Map<string, string>();
  const dupCovers: any[] = [];
  let coversOk = 0;
  for (const cs of cases) {
    const cv = caseCover(cs);
    let ok = true;
    if (cv.mode === 'image') { const c = checkImage(cs.image); if (!c.ok) { ok = false; coverProblems.push({ id: cs.id, slug: cs.slug, name: cs.name, reason: 'обложка: ' + c.reason }); } }
    else {
      const ids = cv.items.map((x: any) => x.id);
      const bad = ids.map((id: number) => one('SELECT name, image FROM items WHERE id=?', id)).filter((r: any) => !r || !checkImage(r.image).ok);
      if (!ids.length) { ok = false; coverProblems.push({ id: cs.id, slug: cs.slug, name: cs.name, reason: 'в кейсе нет предметов для обложки' }); }
      else if (bad.length) { ok = false; coverProblems.push({ id: cs.id, slug: cs.slug, name: cs.name, reason: 'у предметов обложки нет изображения: ' + bad.map((b: any) => b?.name).join(', ') }); }
      const sig = `${cv.theme}|${String(cv.accent).toLowerCase()}|${[...ids].sort((a: number, b: number) => a - b).join(',')}`;
      if (sigs.has(sig)) { ok = false; dupCovers.push({ slug: cs.slug, sameAs: sigs.get(sig) }); } else sigs.set(sig, cs.slug);
    }
    if (ok) coversOk++;
  }
  const brokenRefs = one(`SELECT COUNT(*) n FROM inventory inv JOIN items i ON i.id=inv.item_id WHERE i.image IS NULL OR i.image='' OR i.image LIKE '/img/brand/%'`).n;
  return {
    at: Date.now(),
    summary: {
      skins: items.length, skinsVerified: verified, skinsMissing: missing.length, skinsUnverified: unverified.length, localImages: local, remoteImages: remote,
      wearImages: wear.length, wearImagesBroken: brokenWear.length, cases: cases.length, casesWithVerifiedCover: coversOk, coverProblems: coverProblems.length,
      duplicateCovers: dupCovers.length, brokenImageReferences: missing.length + brokenWear.length + coverProblems.length, inventoryRowsWithoutImage: brokenRefs,
      duplicateImageAssignments: duplicates.length,
    },
    missing: missing.slice(0, limit), unverified: unverified.slice(0, limit), brokenWear: brokenWear.slice(0, limit), duplicates: duplicates.slice(0, limit),
    coverProblems: coverProblems.slice(0, limit), duplicateCovers: dupCovers.slice(0, limit),
  };
}
