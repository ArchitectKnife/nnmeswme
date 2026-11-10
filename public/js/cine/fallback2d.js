// BURGER SKIN — кинодроп: запасной рендер Canvas2D (нет WebGL2 или потерян контекст).
// Та же сцена и та же режиссура, но средствами 2D: градиенты, спрайты дыма и свечения, лучи, разлом,
// волны, подиум с отражением, частицы и настоящая картинка предмета с бликом.
import { TAU, clamp, rgba, rnd, mix3 } from './util.js';
import { WORLD, project, itemModel } from './showcase.js';
import { m4 } from './util.js';

function cnv(w, h = w) { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; }
function glow(c, soft = false) {
  const cv = cnv(64), g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  if (soft) { gr.addColorStop(0, rgba(c, 0.5)); gr.addColorStop(0.5, rgba(c, 0.14)); gr.addColorStop(1, rgba(c, 0)); }
  else { gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, rgba(c, 0.9)); gr.addColorStop(0.45, rgba(c, 0.25)); gr.addColorStop(1, rgba(c, 0)); }
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return cv;
}
function smoke(c) {
  const cv = cnv(128), g = cv.getContext('2d');
  for (let i = 0; i < 16; i++) {
    const x = rnd(32, 96), y = rnd(32, 96), r = rnd(14, 34), gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, rgba(c, 0.18)); gr.addColorStop(1, rgba(c, 0)); g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  return cv;
}

export function create2D(canvas) {
  let g = null;
  try { g = canvas.getContext('2d', { alpha: false }); } catch { g = null; }
  if (!g) return null;
  let W = 2, H = 2, sprites = null, vig = null, bloomC = null, bloomG = null, item = null, cracks = null, fogs = null, bolts = null, boltT = 0;
  const init = (P) => {
    if (sprites) return;
    const { a, b, c } = P.pal;
    sprites = [glow(a), glow(b), glow(c), glow([1, 1, 1])];
    sprites.soft = [glow(a, true), glow(c, true)];
    sprites.smoke = [smoke(a), smoke(c), smoke(mix3(a, b, 0.5))];
    fogs = Array.from({ length: 9 }, (_, i) => ({ x: rnd(-0.6, 0.6), y: rnd(-0.35, 0.45), s: rnd(0.5, 1.1), v: rnd(-0.015, 0.015), k: i % 3, ph: rnd(0, TAU) }));
  };
  const R = {
    kind: '2d', lost: false,
    resize(w, h) {
      W = canvas.width = Math.max(2, w | 0); H = canvas.height = Math.max(2, h | 0);
      vig = cnv(W, H); const v = vig.getContext('2d');
      const gr = v.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.72);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.85)'); v.fillStyle = gr; v.fillRect(0, 0, W, H);
      bloomC = cnv(W / 6, H / 6); bloomG = bloomC.getContext('2d');
    },
    setItem(img) {
      item = null;
      if (!img || !img.naturalWidth) return;
      const w = img.naturalWidth, h = img.naturalHeight;
      // Белый силуэт для проявления и отражение с затуханием — один раз
      const white = cnv(w, h), wg = white.getContext('2d');
      wg.drawImage(img, 0, 0); wg.globalCompositeOperation = 'source-in'; wg.fillStyle = '#fff'; wg.fillRect(0, 0, w, h);
      const refl = cnv(w, h), rg = refl.getContext('2d');
      rg.translate(0, h); rg.scale(1, -1); rg.drawImage(img, 0, 0); rg.setTransform(1, 0, 0, 1, 0, 0);
      rg.globalCompositeOperation = 'destination-in';
      const fg = rg.createLinearGradient(0, 0, 0, h); fg.addColorStop(0, 'rgba(0,0,0,.5)'); fg.addColorStop(0.55, 'rgba(0,0,0,0)'); rg.fillStyle = fg; rg.fillRect(0, 0, w, h);
      const tmp = cnv(w, h);
      item = { img, w, h, asp: w / h, white, refl, tmp, tg: tmp.getContext('2d') };
    },
    get itemAsp() { return item ? item.asp : 4 / 3; },
    render(F) {
      const { S, P, cam, T } = F;
      init(P);
      const { a, b, c, bg } = P.pal;
      const expo = S.expo;
      const sc = (p) => { const q = project(cam, p); return [q[0] * W, (1 - q[1]) * H, q[2]]; };
      const rs = sc(WORLD.rift), re = sc([WORLD.rift[0] + 1, WORLD.rift[1], WORLD.rift[2]]);
      const unit = Math.abs(re[0] - rs[0]);
      const R0 = unit * P.I.riftR * 1.6;
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      const bgG = g.createRadialGradient(rs[0], rs[1], 0, rs[0], rs[1], Math.max(W, H) * 0.8);
      bgG.addColorStop(0, rgba(mix3(bg, a, 0.12 * Math.min(1, S.core) * expo), 1)); bgG.addColorStop(1, rgba(bg.map((x) => x * 0.5), 1));
      g.fillStyle = bgG; g.fillRect(0, 0, W, H);
      g.globalCompositeOperation = 'lighter';
      // дым
      const fogA = clamp(S.fog * (0.25 + 0.6 * Math.min(1.5, S.core)) * expo, 0, 1);
      if (fogA > 0.01) for (const f of fogs) {
        const x = (0.5 + f.x + Math.sin(T * 0.1 + f.ph) * 0.05 + f.v * T) * W, y = (0.5 - f.y) * H, s = f.s * Math.max(W, H) * 0.6;
        g.globalAlpha = fogA * 0.55; g.drawImage(sprites.smoke[f.k], x - s / 2, y - s / 2, s, s);
      }
      // прожекторы
      if (S.spots > 0.01) {
        for (let i = -1; i <= 1; i++) {
          const ax = W / 2 + i * W * 0.32, ay = -H * 0.05, tx = W / 2 + i * W * 0.06, ty = H * 0.75, wd = W * 0.1;
          const gr = g.createLinearGradient(ax, ay, tx, ty); gr.addColorStop(0, rgba(P.spot, 0.22 * S.spots * expo)); gr.addColorStop(1, rgba(P.spot, 0));
          g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.moveTo(ax - 4, ay); g.lineTo(ax + 4, ay); g.lineTo(tx + wd, ty); g.lineTo(tx - wd, ty); g.closePath(); g.fill();
        }
      }
      // лучи
      if (S.rays > 0.01) {
        const L = Math.max(W, H) * 1.1;
        for (let i = 0; i < 18; i++) {
          const an = (i / 18) * TAU + T * 0.05 * (i % 2 ? 1 : -1), w = 0.035 + 0.03 * Math.abs(Math.sin(i * 7.3 + T * 0.4));
          const gr = g.createRadialGradient(rs[0], rs[1], R0 * 0.5, rs[0], rs[1], L); gr.addColorStop(0, rgba(mix3(a, b, 0.5), 0.2 * Math.min(1.2, S.rays) * expo)); gr.addColorStop(1, rgba(a, 0));
          g.globalAlpha = 1; g.fillStyle = gr; g.beginPath(); g.moveTo(rs[0], rs[1]); g.lineTo(rs[0] + Math.cos(an - w) * L, rs[1] + Math.sin(an - w) * L); g.lineTo(rs[0] + Math.cos(an + w) * L, rs[1] + Math.sin(an + w) * L); g.closePath(); g.fill();
        }
      }
      // ядро
      if (S.core > 0.01) {
        const r = unit * (0.6 + Math.min(4, S.core) * 0.9);
        g.globalAlpha = clamp(Math.min(1.2, S.core) * expo); g.drawImage(sprites[0], rs[0] - r, rs[1] - r, r * 2, r * 2);
        g.globalAlpha = clamp(Math.min(1, S.core * 0.5) * expo); g.drawImage(sprites[3], rs[0] - r * 0.3, rs[1] - r * 0.3, r * 0.6, r * 0.6);
      }
      // пол и подиум
      const pc = sc([0, WORLD.floorY, 0]), px = sc([WORLD.platR, WORLD.floorY, 0]), pz = sc([0, WORLD.floorY, WORLD.platR]);
      const prx = Math.abs(px[0] - pc[0]) || 1, pry = Math.max(2, Math.abs(pz[1] - pc[1]));
      g.save(); g.translate(pc[0], pc[1]); g.scale(1, pry / prx);
      g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
      const pool = g.createRadialGradient(0, 0, 0, 0, 0, prx * 2.6); pool.addColorStop(0, rgba(a, (0.12 + 0.25 * S.plat) * expo)); pool.addColorStop(1, rgba(a, 0));
      g.fillStyle = pool; g.beginPath(); g.arc(0, 0, prx * 2.6, 0, TAU); g.fill();
      g.fillStyle = 'rgba(12,13,18,.92)'; g.beginPath(); g.arc(0, 0, prx, 0, TAU); g.fill();
      g.globalCompositeOperation = 'lighter';
      for (const [w, al] of [[prx * 0.08, 0.08], [prx * 0.03, 0.3], [prx * 0.01, 0.9]]) { g.strokeStyle = rgba(a, al * S.plat * expo); g.lineWidth = w; g.beginPath(); g.arc(0, 0, prx * 0.9, 0, TAU); g.stroke(); }
      g.strokeStyle = rgba(b, (0.2 + 0.5 * S.plat) * expo); g.lineWidth = prx * 0.008; g.beginPath(); g.arc(0, 0, prx, 0, TAU); g.stroke();
      if (S.floorWave[1] > 0.01) { g.strokeStyle = rgba(b, 0.6 * S.floorWave[1]); g.lineWidth = prx * 0.05; g.beginPath(); g.arc(0, 0, (S.floorWave[0] / WORLD.platR) * prx, 0, TAU); g.stroke(); }
      g.restore();
      // разлом
      if (S.rift > 0.01) {
        const ry = R0 * S.rift * 1.25, rx = ry * (0.18 + 0.82 * S.slit) * 0.8;
        g.save(); g.translate(rs[0], rs[1]);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
        const vg = g.createRadialGradient(0, 0, 0, 0, 0, ry); vg.addColorStop(0, rgba(bg.map((x) => x * 0.3), 1)); vg.addColorStop(0.8, rgba(mix3(bg, c, 0.35), 1)); vg.addColorStop(1, rgba(a, 0.9));
        g.fillStyle = vg; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.fill();
        g.globalCompositeOperation = 'lighter';
        for (let i = 0; i < 10; i++) {
          const k = 0.5 + (i / 10) * 0.48, st = S.swirl * (1 + i * 0.13) * (i % 2 ? 1 : -1) + i;
          g.strokeStyle = rgba(i % 3 ? a : b, 0.35 * expo); g.lineWidth = Math.max(1, ry * 0.02);
          g.beginPath(); g.ellipse(0, 0, rx * k, ry * k, 0, st, st + 1.4 + (i % 3) * 0.5); g.stroke();
        }
        for (const [w, al, col] of [[ry * 0.16, 0.12, a], [ry * 0.06, 0.4, a], [ry * 0.022, 0.95, b], [Math.max(1, ry * 0.008), 1, [1, 1, 1]]]) { g.strokeStyle = rgba(col, al * expo); g.lineWidth = w; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, TAU); g.stroke(); }
        if (S.lightning > 0.05) {
          if (!bolts || T - boltT > 0.09) { boltT = T; bolts = Array.from({ length: 3 }, () => { const pts = []; let an = rnd(0, TAU); for (let k = 0; k < 8; k++) { an += rnd(-0.5, 0.5); const rr = (k / 7) * 0.95; pts.push([Math.cos(an) * rx * rr, Math.sin(an) * ry * rr]); } return pts; }); }
          g.strokeStyle = rgba(b, 0.8 * S.lightning * expo); g.lineWidth = Math.max(1, ry * 0.012);
          for (const pts of bolts) { g.beginPath(); g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.stroke(); }
        }
        g.restore();
      }
      // волны
      for (const [r, al] of S.waves) { if (al < 0.01) continue; g.strokeStyle = rgba(mix3(a, b, 0.6), al * 0.7 * expo); g.lineWidth = Math.max(1.5, H * 0.006); g.globalAlpha = 1; g.beginPath(); g.arc(rs[0], rs[1], r * H, 0, TAU); g.stroke(); }
      // ореол
      const is = sc([S.item.x, S.item.y, S.item.z]), ie = sc([S.item.x + cam.IW / 2, S.item.y, S.item.z]);
      const iw = Math.abs(ie[0] - is[0]) * 2;
      if (S.halo > 0.01) { const r = iw * 0.75; g.globalAlpha = clamp(S.halo * 0.55); g.drawImage(sprites.soft[0], is[0] - r, is[1] - r, r * 2, r * 2); }
      // частицы
      const pr = F.parts;
      if (pr && pr.n) {
        const vp = cam.vp, dl = S.dustLight;
        for (let i = 0; i < pr.n; i++) {
          const al = pr.alpha(i, dl) * expo; if (al < 0.01) continue;
          const p = [pr.px[i], pr.py[i], pr.pz[i]], q = m4.xform(vp, p); if (q[3] < 0.05) continue;
          const x = (q[0] / q[3] * 0.5 + 0.5) * W, y = (0.5 - q[1] / q[3] * 0.5) * H, sz = Math.max(1, pr.size[i] * cam.proj[5] * 0.5 * H / q[3]);
          const t = pr.type[i];
          if (t === 1 || t === 3) {
            const st = pr.str[i], q2 = m4.xform(vp, [p[0] - pr.vx[i] * st, p[1] - pr.vy[i] * st, p[2] - pr.vz[i] * st]);
            if (q2[3] < 0.05) continue;
            g.globalAlpha = clamp(al); g.strokeStyle = rgba([pr.r[i], pr.g[i], pr.b[i]], 1); g.lineWidth = sz * (t === 3 ? 1.6 : 1.1);
            g.beginPath(); g.moveTo(x, y); g.lineTo((q2[0] / q2[3] * 0.5 + 0.5) * W, (0.5 - q2[1] / q2[3] * 0.5) * H); g.stroke();
          } else {
            const s2 = sz * (t === 4 ? 3 : t === 2 ? 2 : 2.4);
            g.globalAlpha = clamp(al * (t === 4 ? 0.6 : 1)); g.drawImage(t === 4 ? sprites.soft[pr.ci[i] === 2 ? 1 : 0] : sprites[Math.min(3, pr.ci[i])], x - s2, y - s2, s2 * 2, s2 * 2);
          }
        }
      }
      g.globalAlpha = 1;
      // предмет: отражение + сам скин с бликом
      if (item && S.item.vis > 0 && S.item.op > 0.001) {
        const M = itemModel(S, F.drag);
        const cy = Math.cos(S.item.ry + (F.drag?.[0] || 0)), sx = Math.abs(cy) < 0.02 ? 0.02 : cy;
        const sk = Math.sin(S.item.ry) * 0.12;
        const ih = iw / item.asp;
        g.globalCompositeOperation = 'source-over';
        if (S.plat > 0.05) {
          const fy = sc([S.item.x, WORLD.floorY, S.item.z]);
          g.save(); g.translate(is[0], fy[1] + (fy[1] - is[1]) - ih * 0.0); g.scale(sx, 1); g.globalAlpha = 0.5 * S.plat * S.item.op;
          g.drawImage(item.refl, -iw / 2, -ih / 2 + (ih / 2) * 0, iw, ih); g.restore();
        }
        void M;
        g.save(); g.translate(is[0], is[1]); g.rotate(-S.item.rz); g.transform(sx, sk, 0, 1, 0, 0);
        const em = S.item.emerge;
        g.globalAlpha = clamp(S.item.op * (0.15 + 0.85 * em));
        // контровое свечение
        g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(0.35 * S.item.op); const gw = iw * 1.25; g.drawImage(sprites.soft[0], -gw / 2, -gw / 2, gw, gw);
        g.globalCompositeOperation = 'source-over'; g.globalAlpha = clamp(S.item.op * (0.15 + 0.85 * em));
        const sw = S.sweep;
        if (sw > -0.3 && sw < 1.7) {
          const tg = item.tg; tg.globalCompositeOperation = 'copy'; tg.drawImage(item.img, 0, 0);
          tg.globalCompositeOperation = 'source-atop';
          const bx = sw * item.w, gr = tg.createLinearGradient(bx - item.w * 0.18, 0, bx + item.w * 0.18, item.h * 0.3);
          gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
          tg.fillStyle = gr; tg.fillRect(0, 0, item.w, item.h);
          g.drawImage(item.tmp, -iw / 2, -ih / 2, iw, ih);
        } else g.drawImage(item.img, -iw / 2, -ih / 2, iw, ih);
        const wh = Math.max(S.item.white, (1 - em) * 0.9);
        if (wh > 0.01) { g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(wh * S.item.op); g.drawImage(item.white, -iw / 2, -ih / 2, iw, ih); }
        g.restore();
      }
      // разлом реальности (GODLIKE)
      if (S.crack > 0.01) {
        if (!cracks) cracks = Array.from({ length: 14 }, (_, i) => { const pts = [[0, 0]]; let an = (i / 14) * TAU + rnd(-0.2, 0.2), x = 0, y = 0; for (let k = 0; k < 7; k++) { an += rnd(-0.4, 0.4); x += Math.cos(an) * 0.11; y += Math.sin(an) * 0.11; pts.push([x, y]); } return pts; });
        const s = Math.max(W, H);
        g.globalCompositeOperation = 'lighter'; g.strokeStyle = rgba(b, clamp(S.crack * (0.6 + S.shatter))); g.lineWidth = Math.max(1.5, s * (0.002 + S.shatter * 0.01));
        for (const pts of cracks) { const n = Math.max(1, Math.round(pts.length * S.crack)); g.beginPath(); g.moveTo(W / 2, H / 2); for (let k = 1; k < n; k++) g.lineTo(W / 2 + pts[k][0] * s, H / 2 + pts[k][1] * s); g.stroke(); }
      }
      // bloom: уменьшенная копия поверх
      bloomG.globalCompositeOperation = 'copy'; bloomG.drawImage(canvas, 0, 0, bloomC.width, bloomC.height);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = clamp(0.35 * S.bloom); g.drawImage(bloomC, 0, 0, W, H);
      g.globalAlpha = 1;
      if (S.flash > 0.01) { g.fillStyle = rgba(S.flashC, clamp(S.flash * 0.8)); g.fillRect(0, 0, W, H); }
      g.globalCompositeOperation = 'source-over';
      g.drawImage(vig, 0, 0);
      return true;
    },
    destroy() { item = null; sprites = null; R.lost = true; },
  };
  return R;
}
