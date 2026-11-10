// BURGER SKIN — кинодроп: сцена (DOM, HUD, цикл кадров, ввод, качество, запасные режимы).
// Сцена ничего не решает и ничего не отправляет на сервер: предмет, цена и уровень уже выданы
// и записаны сервером. Здесь только показ. Закрыть или пропустить можно всегда.
import { html, mount, rub, WEARS, splitName, rarityRu, cssColor } from '../core.js';
import { icon } from '../icons.js';
import { soundSettings, setSound, unlockSound } from '../sound.js';
import { createCineAudio } from '../cine-sound.js';
import { shareOn, setLiteMode } from '../cine-mode.js';
import { preset, Timeline } from './levels.js';
import { makeScript, evaluate, speedAt, emptyState } from './director.js';
import { camera, project } from './showcase.js';
import { Particles, Emitters } from './particles.js';
import { createGL } from './gl.js';
import { create2D } from './fallback2d.js';
import { clamp, lerp, rgbStr, plural, eOutExpo } from './util.js';
import { openShare } from './share.js';

// Уровни качества: разрешение экрана/окружения, лимит частиц, октавы шума, слои эффектов.
const QS = {
  3: { dpr: 1.75, maxPx: 3.0e6, env: 0.62, parts: 1800, oct: 4, taps: 1, thick: 2, refract: true, chroma: true, bloomK: 1, k2d: 0.9 },
  2: { dpr: 1.35, maxPx: 1.6e6, env: 0.5, parts: 900, oct: 3, taps: 1, thick: 1, refract: true, chroma: true, bloomK: 1, k2d: 0.75 },
  1: { dpr: 1.0, maxPx: 0.8e6, env: 0.4, parts: 360, oct: 2, taps: 0, thick: 0, refract: false, chroma: false, bloomK: 0.85, k2d: 0.6 },
};
const FLOAT_BANDS = [['FN', 0, 0.07], ['MW', 0.07, 0.15], ['FT', 0.15, 0.38], ['WW', 0.38, 0.45], ['BS', 0.45, 1]];

function pickQ(lite) {
  if (lite) return 1;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const small = Math.min(innerWidth, innerHeight) < 700;
  return coarse || small ? 2 : 3;
}

export class CineScene {
  /** o: { item, fx, share, others, caseName, replay, preview, mode, lite, q }; img — уже загруженная картинка предмета или null. */
  constructor(o, img, done) {
    this.o = o; this.item = o.item; this.img = img; this.done = done;
    this.reduced = !!matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    this.lite = !!o.lite;
    this.q0 = o.q && QS[o.q] ? o.q : pickQ(this.lite);
    this.q = this.q0; this.Q = QS[this.q];
    this.prevFocus = document.activeElement;
    this.look = [0, 0]; this.lookT = [0, 0]; this.drag = [0, 0]; this.dragT = [0, 0];
    this.dbg = { speed: 1, pauseAt: null };
    this.buildPreset();
    this.parts = new Particles(this.Q.parts);
    this.emit = new Emitters(this.parts, this.P);
    this.reset();
    this.buildDom();
    this.audio = createCineAudio(this.P);
    this.initRenderer();
    this.bind();
    this.frameB = (t) => this.frame(t);
    this.raf = requestAnimationFrame(this.frameB);
    this.lastFrame = performance.now();
    this.visible = 0;
    this.watch = setInterval(() => this.watchdog(), 1000);
  }
  buildPreset() {
    this.P = preset(this.o.fx, { mode: this.o.mode, reduced: this.reduced, lite: this.lite, item: this.item });
    this.TL = new Timeline(this.P.stages);
    this.script = makeScript(this.P, this.TL);
    this.kParts = this.Q.parts / 1800;
  }
  reset() {
    this.T = 0; this.RT = 0; this.ci = 0; this.S = emptyState(); this.last = 0; this.frameN = 0; this.ema = 1 / 60; this.slowN = 0;
    this.finalAt = null; this.priceTxt = ''; this.amb = null; this.parts.clear(); this.emit.acc = {};
  }

  // ---------- DOM ----------
  buildDom() {
    const it = this.item, P = this.P, o = this.o;
    const [w0, p0] = splitName(it.name || '');
    const weapon = w0.replace(/^★\s*/, '');
    const wear = it.wear && WEARS[it.wear] ? `${WEARS[it.wear]} (${it.wear})` : '';
    const fl = it.float != null && it.float !== '' && Number.isFinite(Number(it.float)) ? clamp(Number(it.float)) : null;
    const others = Math.max(0, Number(o.others) || 0);
    this.canShare = !!(o.share && shareOn() && !o.preview);
    const root = document.createElement('div');
    root.className = `cine lv-${P.level}${P.kind ? ' k-' + P.kind : ''}${this.reduced ? ' rm' : ''}`;
    root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-label', 'Кинодроп');
    root.style.setProperty('--ca', rgbStr(P.css.a)); root.style.setProperty('--cb', rgbStr(P.css.b)); root.style.setProperty('--cc', rgbStr(P.css.c));
    root.style.setProperty('--rc', cssColor(it.color, '#c9d2e3'));
    const letters = (s) => String(s).split(' ').map((wd, wi, arr) => html`<span class="cw">${[...wd].map((ch, i) => html`<span class="ch" style="--i:${wi * 6 + i}">${ch}</span>`)}</span>${wi < arr.length - 1 ? ' ' : ''}`);
    const tags = [];
    if (it.phase) tags.push(html`<span class="ct ph">${it.phase}</span>`);
    if (wear) tags.push(html`<span class="ct">${wear}</span>`);
    if (it.stattrak) tags.push(html`<span class="ct st">StatTrak™</span>`);
    if (it.souvenir) tags.push(html`<span class="ct sv">Сувенир</span>`);
    const sound = this.soundOn();
    mount(root, html`<canvas class="cine-cv" aria-hidden="true"></canvas>
      <div class="cine-bars" aria-hidden="true"><i></i><i></i></div>
      <div class="cine-hud">
        <span class="cine-tag" data-c-tag>${icon('sparkles')}<b>Кинодроп</b></span>
        <button type="button" class="cine-ib" data-c-lite aria-pressed="${this.lite ? 'true' : 'false'}" title="Облегчённые эффекты" aria-label="Облегчённые эффекты">${icon('gauge')}</button>
        <button type="button" class="cine-ib" data-c-snd aria-pressed="${sound ? 'true' : 'false'}" title="${sound ? 'Выключить звук' : 'Включить звук'}" aria-label="Звук">${icon(sound ? 'volume' : 'volumeOff')}</button>
        <button type="button" class="cine-skip" data-c-skip>Пропустить ${icon('chevronRight')}</button>
        <button type="button" class="cine-ib cine-x" data-c-close aria-label="Закрыть">${icon('close')}</button>
      </div>
      <div class="cine-final">
        <div class="cine-head"><div class="cine-kick">${P.kicker}</div><h2 class="cine-title">${letters(P.label)}</h2></div>
        <div class="cine-noimg" hidden>${icon('image')}<span>Изображение предмета недоступно</span></div>
        <div class="cine-panel">
          <div class="cine-info">
            <div class="cine-rar"><i></i>${rarityRu(it.rarityName)}</div>
            ${p0 ? html`<div class="cine-wpn">${weapon}</div>` : ''}
            <div class="cine-name">${p0 || weapon}</div>
            ${tags.length ? html`<div class="cine-tags">${tags}</div>` : ''}
            ${fl != null ? html`<div class="cine-float" title="Float ${fl.toFixed(6)}"><div class="cf-bar">${FLOAT_BANDS.map(([k, a, b]) => html`<i class="cf-${k.toLowerCase()}" style="flex:${(b - a).toFixed(2)}"></i>`)}<b style="left:${(fl * 100).toFixed(2)}%"></b></div><span>Float <b class="mono">${fl.toFixed(6)}</b></span></div>` : ''}
          </div>
          <div class="cine-side">
          <div class="cine-price" data-c-price>${rub(Number(it.price) || 0)}</div>
          ${o.caseName || others ? html`<div class="cine-meta">${o.caseName ? html`<span>Кейс «${o.caseName}»</span>` : ''}${others ? html`<span>ещё ${others} ${plural(others, 'предмет', 'предмета', 'предметов')} в этом открытии</span>` : ''}</div>` : ''}
          <div class="cine-acts">
            <button type="button" class="cine-btn gold" data-c-close>${icon('check')} ${o.preview ? 'Закрыть' : 'Продолжить'}</button>
            <button type="button" class="cine-btn" data-c-replay>${icon('refresh')} Повтор</button>
            ${this.canShare ? html`<button type="button" class="cine-btn" data-c-share>${icon('link')} Поделиться</button>` : ''}
          </div>
          ${o.preview ? html`<p class="cine-note">Предпросмотр: ничего не выдаётся и не записывается.</p>` : ''}
          </div>
        </div>
      </div>
      <div class="cine-sr" aria-live="polite"></div>`);
    document.documentElement.classList.add('cine-open');
    document.body.append(root);
    this.root = root;
    this.cv = root.querySelector('.cine-cv');
    this.priceEl = root.querySelector('[data-c-price]');
    if (!this.img) root.classList.add('noimg');
  }
  soundOn() { const s = soundSettings(); return !!(s.enabled && s.master > 0 && s.cinema > 0); }
  syncSound() {
    const b = this.root.querySelector('[data-c-snd]'); if (!b) return;
    const on = this.soundOn();
    mount(b, icon(on ? 'volume' : 'volumeOff')); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.title = on ? 'Выключить звук' : 'Включить звук';
  }

  // ---------- рендер ----------
  initRenderer() {
    let R = null;
    if (!this.o.force2d) { try { R = createGL(this.cv); } catch (e) { console.warn('[cine]', e); R = null; } }
    if (R) { R.onLost = () => this.toFallback(); this.R = R; }
    else this.R = this.make2D(false);
    if (!this.R) { this.domOnly(); return; }
    try { this.resize(); this.R.setItem(this.img); } catch (e) { console.warn('[cine] renderer', e); this.toFallback(); }
  }
  make2D(replace = true) {
    if (replace) { const nc = document.createElement('canvas'); nc.className = 'cine-cv'; nc.setAttribute('aria-hidden', 'true'); this.cv.replaceWith(nc); this.cv = nc; }
    try { return create2D(this.cv); } catch { return null; }
  }
  toFallback() {
    if (this.dead) return;
    const old = this.R;
    if (old?.kind === '2d') { this.domOnly(); return; }
    try { old?.destroy(); } catch { /* ignore */ }
    this.R = this.make2D(true);
    if (!this.R) { this.domOnly(); return; }
    this.parts.resize(Math.min(this.parts.cap, 420));
    try { this.resize(); this.R.setItem(this.img); } catch { this.domOnly(); }
  }
  /** Без холста: финальная карточка поверх тёмного фона с настоящей картинкой предмета. */
  domOnly() {
    if (this.dead) return;
    try { this.R?.destroy(); } catch { /* ignore */ }
    this.R = null;
    this.root.classList.add('domonly');
    if (this.img && !this.root.querySelector('.cine-dimg')) {
      const im = document.createElement('img');
      im.className = 'cine-dimg'; im.alt = this.item.name || ''; im.src = this.img.src;
      this.root.querySelector('.cine-final')?.prepend(im);
    }
    this.skip();
  }
  resize() {
    if (!this.R) return;
    const w = this.root.clientWidth || innerWidth, h = this.root.clientHeight || innerHeight;
    const Q = this.Q;
    const is2d = this.R.kind === '2d';
    let dpr = Math.min(devicePixelRatio || 1, is2d ? 1.25 : Q.dpr) * (is2d ? Q.k2d : 1);
    let W = w * dpr, H = h * dpr;
    const cap = is2d ? 1.1e6 : Q.maxPx;
    const k = Math.min(1, Math.sqrt(cap / (W * H)));
    W = Math.round(W * k); H = Math.round(H * k);
    this.R.resize(W, H, Q.env);
  }
  setQuality(q) {
    if (q === this.q || !QS[q]) return;
    this.q = q; this.Q = QS[q]; this.kParts = this.Q.parts / 1800;
    this.parts.resize(this.R?.kind === '2d' ? Math.min(this.Q.parts, 420) : this.Q.parts);
    try { this.resize(); } catch { this.toFallback(); }
  }
  draw() {
    const R = this.R; if (!R) return;
    const S = this.S;
    const cam = camera(S, this.cv.width, this.cv.height, R.itemAsp, this.T, this.look);
    this.cam = cam;
    const gl = R.kind === 'gl';
    const np = gl ? this.parts.write(S) : 0;
    let ok = true;
    try { ok = R.render({ S, P: this.P, cam, Q: this.Q, T: this.T, np, pbuf: this.parts.buf, parts: this.parts, drag: this.drag }); }
    catch (e) { console.warn('[cine] render', e); ok = false; }
    if (ok === false) { if (gl) this.toFallback(); else this.domOnly(); return; }
    // Прямоугольник предмета на экране — для клика «мимо» и рамки «нет изображения»
    if (S.item.vis) {
      const c = project(cam, [S.item.x, S.item.y, S.item.z]), e = project(cam, [S.item.x + cam.IW / 2, S.item.y + cam.IW / 2 / R.itemAsp, S.item.z]);
      const w = this.root.clientWidth, h = this.root.clientHeight;
      const hw = Math.abs(e[0] - c[0]) * w, hh = Math.abs(e[1] - c[1]) * h;
      this.itemRect = [c[0] * w - hw, (1 - c[1]) * h - hh, c[0] * w + hw, (1 - c[1]) * h + hh];
      if (!this.img && !this.noImgPlaced) {
        const ni = this.root.querySelector('.cine-noimg');
        if (ni) { ni.hidden = false; ni.style.left = `${c[0] * 100}%`; ni.style.top = `${(1 - c[1]) * 100}%`; ni.style.width = `${hw * 2}px`; ni.style.height = `${hh * 2}px`; }
        if (S.final) this.noImgPlaced = true;
      }
    }
  }

  // ---------- цикл ----------
  frame(now) {
    if (this.dead) return;
    this.raf = requestAnimationFrame(this.frameB);
    this.lastFrame = performance.now();
    if (document.hidden) { this.last = 0; return; }
    let dr = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    dr = clamp(dr, 0, 0.05);
    this.frameN++;
    // Адаптивное качество: устойчиво низкий FPS → снижаем разрешение и эффекты
    if (!this.o.q && this.frameN > 40 && this.R) {
      this.ema = lerp(this.ema, dr, 0.05);
      if (this.ema > 1 / 38) { if (++this.slowN > 45 && this.q > 1) { this.slowN = 0; this.setQuality(this.q - 1); } } else this.slowN = Math.max(0, this.slowN - 1);
    }
    // На финале в простое — 30 FPS
    const idle = this.S.final && this.finalAt != null && this.RT - this.finalAt > 10 && !this.dragging;
    if (idle && this.frameN % 2) return;
    if (idle) dr *= 2;
    this.RT += dr;
    let dt = dr * speedAt(this.P, this.TL, this.T) * this.dbg.speed;
    if (this.dbg.pauseAt != null) dt = Math.max(0, Math.min(dt, this.dbg.pauseAt - this.T));
    this.T += dt;
    this.runCues();
    evaluate(this.P, this.TL, this.script, this.T, this.S);
    this.inputStep(dr);
    if (this.R) {
      this.emit.tick(dt, this.S, this.R.kind === '2d' ? Math.min(this.kParts, 0.25) : this.kParts);
      this.parts.update(dt, this.S);
    }
    this.draw();
    this.hudStep();
  }
  runCues() {
    const cues = this.script.cues;
    while (this.ci < cues.length && cues[this.ci].t <= this.T) {
      const c = cues[this.ci++];
      try { this.cue(c); } catch (e) { console.warn('[cine] cue', c.name, e); }
    }
  }
  cue({ name, arg }) {
    const A = this.audio, E = this.emit, P = this.P, I = P.I, k = this.R?.kind === '2d' ? Math.min(this.kParts, 0.25) : this.kParts;
    switch (name) {
      case 'ambience': this.amb = A.ambience(); break;
      case 'dust': E.dust(Math.round(160 * I.dust * k)); break;
      case 'heartbeat': A.heartbeat(arg); break;
      case 'portal': A.portal(); A.whoosh(1.1); this.amb?.swell(0.45, 1.2); break;
      case 'swell': A.swell(); this.amb?.swell(0.3, 1); break;
      case 'charge': this.chargeH = A.charge(arg); break;
      case 'wave': A.pulse(0.4 + 0.1 * P.li); E.ring(Math.round(48 * k * (0.5 + P.intensity))); break;
      case 'slash': A.shing(0, arg === 0 ? 1 : 0.7); if (!P.reduced) E.slash(arg); break;
      case 'wisps': A.glove(0, 0.55); for (let i = 0; i < 6; i++) E.wispOne(); break;
      case 'riser': this.riserH = A.riser(arg); this.amb?.swell(0.85, arg); break;
      case 'pulse': A.pulse(0.55 + 0.35 * P.intensity); break;
      case 'suck': A.suck(arg); break;
      case 'blackout': A.blackout(); break;
      case 'crack': A.crack(); break;
      case 'shatter':
        A.shatter();
        if (!P.reduced) { E.shards(Math.round(I.shards * Math.max(k, 0.3)), { at: [0, 0, 0.4], min: 2.5, max: 8, big: true }); E.sparks(Math.round(I.sparks * 0.5 * k), { at: [0, 0, 0], max: 11 }); }
        break;
      case 'reveal': this.onReveal(k); break;
      case 'final': this.onFinal(); break;
      default: break;
    }
  }
  onReveal(k) {
    const A = this.audio, E = this.emit, P = this.P, I = P.I;
    try { this.riserH?.stop(); this.chargeH?.stop(); } catch { /* ignore */ }
    A.impact(P.reduced ? 0.45 : 0.65 + 0.2 * P.li);
    A.metal(1, 0.03, 0.12 + 0.03 * P.li);
    A.reveal(0.1);
    if (P.kind === 'knife') A.shing(0.02, 1);
    if (P.kind === 'glove') A.glove(0.02, 1);
    this.amb?.swell(0.25, 1.5);
    if (!P.reduced) {
      E.sparks(Math.round(I.sparks * k), { at: [0, 0, -0.7] });
      if (I.shards) E.shards(Math.round(I.shards * Math.max(k, 0.3)), { at: [0, 0, -0.7] });
    } else E.sparks(Math.round(I.sparks * 0.15 * k), { at: [0, 0, -0.4], max: 3 });
    const it = this.item;
    const sr = this.root.querySelector('.cine-sr');
    if (sr) sr.textContent = `${this.P.label}. Выпал предмет: ${it.name}${it.wear && WEARS[it.wear] ? ', ' + WEARS[it.wear] : ''}. Стоимость ${rub(Number(it.price) || 0)}.`;
    const tag = this.root.querySelector('[data-c-tag]');
    if (tag) mount(tag, html`${icon(P.icon)}<b>${P.label}</b>`);
  }
  onFinal() {
    if (this.root.classList.contains('final')) return;
    this.root.classList.add('final');
    this.finalAt = this.RT;
    this.audio.sparkle(0.05);
    if (!this.amb || this.P.I.blackout) { this.amb = this.audio.ambience(); this.amb.swell(0.15, 2); }
    setTimeout(() => { if (!this.dead) this.root.querySelector('.cine-acts [data-c-close]')?.focus({ preventScroll: true }); }, 60);
  }
  hudStep() {
    const S = this.S, st = this.root;
    const lb = Math.round(S.letterbox * 100) / 100;
    if (lb !== this.lb) { this.lb = lb; st.style.setProperty('--lb', String(lb)); }
    if (S.stage !== this.stage) { this.stage = S.stage; st.dataset.stage = S.stage; }
    if (S.final && this.finalAt != null && this.priceEl) {
      const u = this.RT - this.finalAt, price = Number(this.item.price) || 0;
      const v = this.reduced || u >= 1.3 ? price : Math.round(price * eOutExpo(u / 1.3));
      const t = rub(v);
      if (t !== this.priceTxt) { this.priceTxt = t; this.priceEl.textContent = t; }
    }
    // Спекулярный «звон» металла при каждом проходе блика
    if (S.sweep > -0.2 && S.sweep < 0 && !this.glinted) { this.glinted = true; this.audio.glint(); }
    if (S.sweep > 1) this.glinted = false;
  }
  inputStep(dr) {
    const k = 1 - Math.exp(-dr * 4);
    this.look[0] += (this.lookT[0] - this.look[0]) * k; this.look[1] += (this.lookT[1] - this.look[1]) * k;
    if (!this.dragging) { this.dragT[0] *= Math.exp(-dr * 2.2); this.dragT[1] *= Math.exp(-dr * 2.2); }
    const k2 = 1 - Math.exp(-dr * 10);
    this.drag[0] += (this.dragT[0] - this.drag[0]) * k2; this.drag[1] += (this.dragT[1] - this.drag[1]) * k2;
  }
  watchdog() {
    if (this.dead) return;
    if (document.hidden) return;
    this.visible++;
    // requestAnimationFrame не идёт, хотя вкладка видна (сбой браузера/GPU) — показываем итог без холста.
    if (performance.now() - this.lastFrame > 2500 && !this.root.classList.contains('domonly')) { this.domOnly(); return; }
    if (!this.S.final && this.visible > this.TL.total * 3 + 12 && this.dbg.pauseAt == null) this.skip();
  }

  // ---------- действия ----------
  skip() {
    if (this.dead || this.S.final) { if (this.root.classList.contains('domonly')) this.onFinal(); return; }
    const tR = this.TL.start('reveal'), dR = this.TL.dur('reveal');
    const before = this.T < tR;
    try { this.audio.stopAll(0.2); } catch { /* ignore */ }
    this.T = Math.max(this.T, tR + dR * 0.8);
    const cues = this.script.cues;
    while (this.ci < cues.length && cues[this.ci].t <= this.T) { const c = cues[this.ci++]; if (c.name === 'final') this.onFinal(); }
    if (before) {
      this.parts.clear();
      this.emit.dust(Math.round(90 * this.P.I.dust * this.kParts));
      this.audio.impact(0.4); this.audio.reveal(0, true);
      this.amb = null;
      const tag = this.root.querySelector('[data-c-tag]');
      if (tag) mount(tag, html`${icon(this.P.icon)}<b>${this.P.label}</b>`);
      const it = this.item, sr = this.root.querySelector('.cine-sr');
      if (sr) sr.textContent = `${this.P.label}. Выпал предмет: ${it.name}. Стоимость ${rub(Number(it.price) || 0)}.`;
      if (!this.reduced && this.cv) { this.cv.classList.remove('skipfade'); void this.cv.offsetWidth; this.cv.classList.add('skipfade'); }
    }
    this.onFinal();
    evaluate(this.P, this.TL, this.script, this.T, this.S);
  }
  replay() {
    if (this.dead) return;
    try { this.audio.stopAll(0.2); } catch { /* ignore */ }
    this.root.classList.remove('final');
    this.reset();
    this.noImgPlaced = false;
    const tag = this.root.querySelector('[data-c-tag]');
    if (tag) mount(tag, html`${icon('sparkles')}<b>Кинодроп</b>`);
    if (this.priceEl) this.priceEl.textContent = rub(Number(this.item.price) || 0);
    this.root.querySelector('[data-c-skip]')?.focus({ preventScroll: true });
  }
  toggleSound() {
    const on = !this.soundOn();
    const s = soundSettings(); const patch = { enabled: on };
    if (on && !(s.master > 0)) patch.master = 0.7;
    if (on && !(s.cinema > 0)) patch.cinema = 0.9;
    setSound(patch);
    if (on) {
      try { unlockSound(); } catch { /* ignore */ }
      if (this.audio.silent) { this.audio = createCineAudio(this.P); if (!this.audio.silent) { this.amb = this.audio.ambience(); this.amb.swell(this.S.revealed ? 0.15 : 0.5, 1); } }
    }
    this.syncSound();
  }
  toggleLite() {
    this.lite = !this.lite;
    setLiteMode(this.lite);
    const b = this.root.querySelector('[data-c-lite]'); if (b) b.setAttribute('aria-pressed', this.lite ? 'true' : 'false');
    const T = this.T, ci = this.ci;
    this.buildPreset();
    this.T = T; this.ci = ci;
    this.emit = new Emitters(this.parts, this.P);
    this.setQuality(this.lite ? 1 : Math.max(this.q0, 2));
  }
  bind() {
    const root = this.root;
    this.onClick = (e) => {
      const t = e.target.closest('button');
      if (!t || !root.contains(t)) return;
      if (t.matches('[data-c-skip]')) this.skip();
      else if (t.matches('[data-c-close]')) this.close();
      else if (t.matches('[data-c-replay]')) this.replay();
      else if (t.matches('[data-c-share]')) openShare({ item: this.item, fx: this.P.fx, share: this.o.share });
      else if (t.matches('[data-c-snd]')) this.toggleSound();
      else if (t.matches('[data-c-lite]')) this.toggleLite();
    };
    root.addEventListener('click', this.onClick);
    // Параллакс от указателя; на финале — поворот предмета пальцем/мышью, клик мимо предмета закрывает.
    let down = null;
    this.onMove = (e) => {
      if (!this.reduced) { const w = root.clientWidth || 1, h = root.clientHeight || 1; this.lookT = [(e.clientX / w) * 2 - 1, -((e.clientY / h) * 2 - 1)]; }
      if (down && this.S.final) {
        const dx = e.clientX - down.x, dy = e.clientY - down.y;
        if (Math.hypot(dx, dy) > 6) { down.moved = true; this.dragging = true; root.classList.add('drag'); }
        if (down.moved) { this.dragT = [clamp(down.ry + dx * 0.006, -0.9, 0.9), clamp(down.rx + dy * 0.004, -0.4, 0.4)]; }
      }
    };
    this.onDown = (e) => {
      if (e.target !== this.cv || !this.S.final) return;
      down = { x: e.clientX, y: e.clientY, ry: this.dragT[0], rx: this.dragT[1], moved: false };
      try { this.cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    this.onUp = (e) => {
      if (!down) return;
      const d = down; down = null; this.dragging = false; root.classList.remove('drag');
      if (!d.moved && this.S.final && e.target === this.cv) {
        const r = this.itemRect;
        const inside = r && e.clientX >= r[0] && e.clientX <= r[2] && e.clientY >= r[1] && e.clientY <= r[3];
        if (!inside) this.close();
      }
    };
    root.addEventListener('pointermove', this.onMove);
    root.addEventListener('pointerdown', this.onDown);
    root.addEventListener('pointerup', this.onUp);
    root.addEventListener('pointercancel', () => { down = null; this.dragging = false; root.classList.remove('drag'); });
    this.onKey = (e) => {
      if (document.querySelector('.cine-sharebox')) return;
      if (e.key === 'Escape') { e.preventDefault(); if (!this.S.final) this.skip(); else this.close(); }
      else if ((e.key === ' ' || e.key === 'Enter') && !this.S.final && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); this.skip(); }
      else if (e.key === 'Tab') {
        const f = [...root.querySelectorAll('button:not([disabled])')].filter((b) => b.offsetParent !== null);
        if (!f.length) return;
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && (i <= 0)) { e.preventDefault(); f[f.length - 1].focus(); }
        else if (!e.shiftKey && (i === f.length - 1 || i < 0)) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', this.onKey);
    this.onResize = () => { try { this.resize(); } catch { this.toFallback(); } };
    addEventListener('resize', this.onResize);
    this.onVis = () => { try { this.audio.mute(document.hidden); } catch { /* ignore */ } this.last = 0; };
    document.addEventListener('visibilitychange', this.onVis);
    this.onPop = () => this.close(true);
    addEventListener('popstate', this.onPop);
    setTimeout(() => { if (!this.dead) root.querySelector('[data-c-skip]')?.focus({ preventScroll: true }); }, 60);
  }
  close(instant = false) {
    if (this.dead) return;
    this.dead = true;
    cancelAnimationFrame(this.raf);
    clearInterval(this.watch);
    document.removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVis);
    removeEventListener('resize', this.onResize);
    removeEventListener('popstate', this.onPop);
    const audio = this.audio, R = this.R, root = this.root;
    try { audio.stopAll(0.25); } catch { /* ignore */ }
    setTimeout(() => { try { audio.dispose(); } catch { /* ignore */ } }, 400);
    try { R?.destroy(); } catch { /* ignore */ }
    this.R = null;
    const fin = () => { root.remove(); if (!document.querySelector('.cine')) document.documentElement.classList.remove('cine-open'); };
    if (instant || this.reduced) fin(); else { root.classList.add('out'); setTimeout(fin, 330); }
    try { if (this.prevFocus && document.contains(this.prevFocus)) this.prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
    const d = this.done; this.done = null;
    d?.();
  }
  /** Для автотестов и админ-предпросмотра: замедление, пауза на моменте, текущее состояние. */
  debug() {
    return {
      speed: (k) => { this.dbg.speed = k; },
      pauseAt: (t) => { this.dbg.pauseAt = t; },
      resume: () => { this.dbg.pauseAt = null; },
      state: () => ({ T: this.T, stage: this.S.stage, final: this.S.final, revealed: this.S.revealed, renderer: this.R?.kind || 'dom', q: this.q, lite: this.lite, reduced: this.reduced, hdr: this.R?.hdr ?? null, parts: this.parts.n, total: this.TL.total, stages: this.P.stages, level: this.P.level, kind: this.P.kind, noImg: !this.img }),
      skip: () => this.skip(),
      close: () => this.close(),
      loseContext: () => { try { this.cv.getContext('webgl2')?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ } },
    };
  }
}
