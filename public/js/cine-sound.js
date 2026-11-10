// BURGER SKIN — звуковой дизайн кинодропов.
// Все звуки оригинальные и синтезируются прямо в браузере (WebAudio: осцилляторы, FM, шум, фильтры,
// гребенчатые задержки, перегруз, сгенерированная реверберация). Сторонних сэмплов и музыки нет.
// Громкость: общий канал сайта → канал «Кинодропы» (панель звука и кнопка в самой сцене).
import { cineBus } from './sound.js';

const NOOP_H = { stop() {}, swell() {} };
const NAMES = ['ambience', 'charge', 'portal', 'swell', 'pulse', 'heartbeat', 'riser', 'suck', 'blackout', 'impact', 'metal', 'reveal', 'choir', 'stinger', 'crack', 'shatter', 'shing', 'glove', 'whoosh', 'sparkle', 'glint', 'mute', 'stopAll', 'dispose'];
const SILENT = { silent: true };
for (const k of NAMES) SILENT[k] = () => NOOP_H;

// Тональность уровня: бас и аккорд раскрытия (от чистого мажора к сложным «небесным» созвучиям).
const KEYS = {
  standard: { root: 49.0, chord: [392.0, 493.88, 587.33, 783.99] },
  rare: { root: 46.25, chord: [369.99, 466.16, 554.37, 739.99, 932.33] },
  epic: { root: 41.2, chord: [329.63, 392.0, 493.88, 587.33, 739.99] },
  legendary: { root: 36.71, chord: [293.66, 369.99, 440.0, 587.33, 739.99, 880.0] },
  godlike: { root: 32.7, chord: [261.63, 329.63, 392.0, 493.88, 587.33, 739.99, 987.77] },
};

/** p — пресет сцены ({ level, kind, li }) или строка уровня. */
export function createCineAudio(p = 'epic') {
  const b = cineBus();
  if (!b) return SILENT;
  const { ctx, bus } = b;
  const level = typeof p === 'string' ? (KEYS[p] ? p : 'epic') : p.level || 'epic';
  const kind = typeof p === 'string' ? (p === 'knife' || p === 'glove' ? p : null) : p.kind;
  const li = Math.max(0, ['standard', 'rare', 'epic', 'legendary', 'godlike'].indexOf(level));
  const key = KEYS[level];
  const OUT = 0.7;
  const out = ctx.createGain(); out.gain.value = OUT; out.connect(bus);
  const rev = ctx.createConvolver(); rev.buffer = impulse(ctx, 3.2, 2.6);
  const wet = ctx.createGain(); wet.gain.value = 0.3 + li * 0.04; rev.connect(wet); wet.connect(out);
  const nb = noiseBuf(ctx);
  const live = new Set();
  const now = (at = 0) => ctx.currentTime + Math.max(0, at);
  const gain = (v = 1, send = 0, dest = out) => {
    const g = ctx.createGain(); g.gain.value = v; g.connect(dest);
    if (send) { const s = ctx.createGain(); s.gain.value = send; g.connect(s); s.connect(rev); }
    return g;
  };
  const filt = (type, f, q = 0.7) => { const x = ctx.createBiquadFilter(); x.type = type; x.frequency.value = f; x.Q.value = q; return x; };
  const osc = (type, f, t, dur, det = 0) => { const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f, t); o.detune.value = det; o.start(t); o.stop(t + dur + 0.1); return o; };
  const noise = (t, dur) => { const s = ctx.createBufferSource(); s.buffer = nb; s.loop = true; s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.1); return s; };
  const env = (g, t, a, peak, d) => { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); };
  const drive = (() => { const w = ctx.createWaveShaper(); const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 2.8); } w.curve = c; w.connect(out); return w; })();
  const fadeOut = (g, fade) => { const n = ctx.currentTime; g.gain.cancelScheduledValues(n); g.gain.setValueAtTime(Math.max(0.0002, g.gain.value), n); g.gain.exponentialRampToValueAtTime(0.0001, n + fade); };
  const track = (h, ms) => { live.add(h); if (ms) setTimeout(() => live.delete(h), ms); return h; };

  const api = {
    /** Фон сцены: низкий дрон, «воздух» и инфрабас. swell(0..1) открывает фильтр и усиливает. */
    ambience() {
      const t = now();
      const g = gain(0.0001, 0.25); const lp = filt('lowpass', 130, 2.2); lp.connect(g);
      const nodes = [];
      for (const [type, mul, det, v] of [['sine', 1, 0, 0.9], ['sine', 2.002, 0, 0.3], ['sawtooth', 2, -6, 0.16], ['sawtooth', 2, 6, 0.16], ['triangle', 3, 4, 0.08]]) {
        const o = osc(type, key.root * mul, t, 90, det); const og = ctx.createGain(); og.gain.value = v; o.connect(og); og.connect(lp); nodes.push(o);
      }
      const lfo = osc('sine', 0.11, t, 90); const lg = ctx.createGain(); lg.gain.value = 35; lfo.connect(lg); lg.connect(lp.frequency); nodes.push(lfo);
      const air = gain(0.0001, 0.3); const bp = filt('bandpass', 900, 0.6); bp.connect(air); const ns = noise(t, 90); ns.connect(bp); nodes.push(ns);
      const lfo2 = osc('sine', 0.07, t, 90); const lg2 = ctx.createGain(); lg2.gain.value = 500; lfo2.connect(lg2); lg2.connect(bp.frequency); nodes.push(lfo2);
      g.gain.exponentialRampToValueAtTime(0.32, t + 2.4); air.gain.exponentialRampToValueAtTime(0.035, t + 3);
      const h = {
        stop(fade = 0.5) { fadeOut(g, fade); fadeOut(air, fade); const n = ctx.currentTime; for (const o of nodes) { try { o.stop(n + fade + 0.05); } catch { /* уже остановлен */ } } live.delete(h); },
        swell(lv = 1, time = 0.8) { const n = ctx.currentTime; lp.frequency.cancelScheduledValues(n); lp.frequency.setValueAtTime(lp.frequency.value, n); lp.frequency.exponentialRampToValueAtTime(130 + lv * 1500, n + time); g.gain.setTargetAtTime(0.32 + lv * 0.18, n, time / 3); },
      };
      return track(h);
    },
    /** Зарядка энергии: FM-тон с растущим индексом модуляции + шумовая развёртка. */
    charge(dur = 2.5, at = 0) {
      const t = now(at); const g = gain(0.0001, 0.35);
      const car = osc('sine', 180, t, dur); car.frequency.exponentialRampToValueAtTime(880, t + dur);
      const mod = osc('sine', 270, t, dur); mod.frequency.exponentialRampToValueAtTime(1320, t + dur);
      const mg = ctx.createGain(); mg.gain.setValueAtTime(40, t); mg.gain.exponentialRampToValueAtTime(700, t + dur); mod.connect(mg); mg.connect(car.frequency);
      const cg = ctx.createGain(); cg.gain.value = 0.05; car.connect(cg); cg.connect(g);
      const bp = filt('bandpass', 300, 4); bp.frequency.exponentialRampToValueAtTime(5200, t + dur); const ng = ctx.createGain(); ng.gain.value = 0.25; noise(t, dur).connect(bp); bp.connect(ng); ng.connect(g);
      g.gain.exponentialRampToValueAtTime(0.4, t + dur * 0.95); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.08);
      return track({ stop() { fadeOut(g, 0.1); live.delete(this); }, swell() {} }, (dur + at + 0.3) * 1000);
    },
    /** Активация портала: вихрь (гребенчатая задержка с модуляцией), свист и низкий удар. */
    portal(at = 0) {
      const t = now(at); const g = gain(1, 0.7);
      const bp = filt('bandpass', 200, 1.2); bp.frequency.exponentialRampToValueAtTime(2200, t + 0.7); bp.frequency.exponentialRampToValueAtTime(380, t + 1.8);
      const ng = ctx.createGain(); env(ng, t, 0.35, 0.5, 1.5); noise(t, 2).connect(bp); bp.connect(ng);
      const dl = ctx.createDelay(0.05); dl.delayTime.value = 0.006; const fb = ctx.createGain(); fb.gain.value = 0.82;
      ng.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(g); ng.connect(g);
      const lfo = osc('sine', 0.9, t, 2); const lg = ctx.createGain(); lg.gain.value = 0.004; lfo.connect(lg); lg.connect(dl.delayTime);
      const o = osc('sine', 72, t, 1.4); o.frequency.exponentialRampToValueAtTime(34, t + 1.3); const og = ctx.createGain(); env(og, t, 0.02, 0.7, 1.2); o.connect(og); og.connect(g);
      setTimeout(() => { try { fb.gain.value = 0; } catch { /* ignore */ } }, (at + 2.4) * 1000);
    },
    /** STANDARD: мягкое светлое нарастание без портала. */
    swell(at = 0) {
      const t = now(at); const g = gain(1, 0.5);
      for (const f of [key.chord[0] / 2, key.chord[2] / 2]) { const o = osc('triangle', f, t, 1.2); const og = ctx.createGain(); env(og, t, 0.5, 0.06, 0.7); o.connect(og); og.connect(g); }
      const hp = filt('highpass', 2500, 0.7); const ng = ctx.createGain(); env(ng, t, 0.6, 0.06, 0.4); noise(t, 1.1).connect(hp); hp.connect(ng); ng.connect(g);
    },
    /** Световой импульс: инфрабас с щелчком. */
    pulse(v = 0.7, at = 0) {
      const t = now(at); const g = gain(1, 0.25);
      const o = osc('sine', 62, t, 0.5); o.frequency.exponentialRampToValueAtTime(32, t + 0.4); const og = ctx.createGain(); env(og, t, 0.005, 0.8 * v, 0.42); o.connect(og); og.connect(g);
      const hp = filt('highpass', 1800, 0.7); const ng = ctx.createGain(); env(ng, t, 0.002, 0.12 * v, 0.05); noise(t, 0.1).connect(hp); hp.connect(ng); ng.connect(g);
    },
    heartbeat(v = 0.6, at = 0) { api.pulse(v, at); api.pulse(v * 0.7, at + 0.17); },
    /** Нарастание напряжения: расстроенные пилы ползут вверх + шумовая развёртка. */
    riser(dur = 1.6, at = 0) {
      const t = now(at); const g = gain(0.0001, 0.45);
      const hp = filt('highpass', 400, 0.8); hp.frequency.exponentialRampToValueAtTime(7500, t + dur); const ng = ctx.createGain(); ng.gain.value = 0.5; noise(t, dur).connect(hp); hp.connect(ng); ng.connect(g);
      const lp = filt('lowpass', 600, 1.5); lp.frequency.exponentialRampToValueAtTime(6000, t + dur); lp.connect(g);
      for (const [m, det] of [[4, -10], [4, 10], [6, 0]]) { const o = osc('sawtooth', key.root * m, t, dur, det); o.frequency.exponentialRampToValueAtTime(key.root * m * 2, t + dur); const og = ctx.createGain(); og.gain.value = 0.05; o.connect(og); og.connect(lp); }
      g.gain.exponentialRampToValueAtTime(0.42, t + dur * 0.97); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05);
      return track({ stop() { fadeOut(g, 0.08); live.delete(this); }, swell() {} }, (dur + at + 0.2) * 1000);
    },
    /** Обратный «вдох» перед ударом. */
    suck(dur = 0.5, at = 0) {
      const t = now(at); const g = gain(0.0001, 0.5); const hp = filt('highpass', 900, 0.8); hp.connect(g); noise(t, dur).connect(hp);
      hp.frequency.exponentialRampToValueAtTime(6000, t + dur); g.gain.exponentialRampToValueAtTime(0.45, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.03);
    },
    /** GODLIKE: провал звука перед разломом реальности — остаётся только сердцебиение. */
    blackout(at = 0) {
      const t = now(at);
      for (const h of [...live]) { try { h.stop(0.25); } catch { /* ignore */ } }
      api.heartbeat(0.9, at + 0.12);
      const o = osc('sine', 7000, t, 0.5); const og = ctx.createGain(); env(og, t, 0.1, 0.012, 0.35); o.connect(og); og.connect(gain(1, 0.6));
    },
    /** Глубокий кинематографичный удар; с LEGENDARY — «брэм» из расстроенных пил. */
    impact(power = 1, at = 0) {
      const t = now(at); const g = gain(1, 0.55);
      const o = osc('sine', 95, t, 1.6); o.frequency.exponentialRampToValueAtTime(27, t + 1.3); const og = ctx.createGain(); env(og, t, 0.004, Math.min(1.3, 1.0 * power), 1.4); o.connect(og); og.connect(drive);
      const lp = filt('lowpass', 1500, 0.9); lp.frequency.exponentialRampToValueAtTime(180, t + 1.2); const ng = ctx.createGain(); env(ng, t, 0.003, 0.6 * power, 1.3); noise(t, 1.6).connect(lp); lp.connect(ng); ng.connect(g);
      const th = osc('triangle', 150, t, 0.4); th.frequency.exponentialRampToValueAtTime(55, t + 0.3); const tg = ctx.createGain(); env(tg, t, 0.002, 0.5 * power, 0.3); th.connect(tg); tg.connect(g);
      if (li >= 3 || power > 1.1) {
        const blp = filt('lowpass', 260, 2); blp.frequency.exponentialRampToValueAtTime(1900, t + 0.25); blp.frequency.exponentialRampToValueAtTime(320, t + 2.4);
        const bg = ctx.createGain(); env(bg, t, 0.03, 0.22 * power, 2.4); blp.connect(bg); bg.connect(gain(1, 0.6));
        for (const [m, d] of [[2, -9], [2, 9], [3, -5], [4, 4], [1, 0]]) { const s = osc('sawtooth', key.root * m, t, 2.6, d); s.connect(blp); }
      }
    },
    /** Металлический звон: неармонические парциалы, как у колокола или клинка. */
    metal(pitch = 1, at = 0, v = 0.25) {
      const t = now(at); const g = gain(1, 0.7);
      [1, 2.76, 5.4, 8.93, 13.34].forEach((m, i) => { if (420 * pitch * m > ctx.sampleRate * 0.45) return; const o = osc('sine', 420 * pitch * m, t, 2.4); const og = ctx.createGain(); env(og, t, 0.002, v / (1 + i * 0.7), 2.2 / (1 + i * 0.6)); o.connect(og); og.connect(g); });
    },
    /** Аккорд раскрытия уровня: пэд + блёстки-арпеджио (с EPIC) + небесный хор (GODLIKE). */
    reveal(at = 0, soft = false) {
      const t = now(at); const g = gain(soft ? 0.6 : 1, 0.65);
      const lp = filt('lowpass', kind === 'glove' ? 2400 : 4200, 0.7); lp.connect(g);
      key.chord.forEach((f, i) => {
        for (const det of [-7, 7]) { const o = osc(i % 2 ? 'triangle' : 'sawtooth', f, t + i * 0.012, 4.2, det); const og = ctx.createGain(); env(og, t + i * 0.012, 0.06, 0.05, 3.8); o.connect(og); og.connect(lp); }
      });
      const sub = osc('sine', key.root * 2, t, 3); const sg = ctx.createGain(); env(sg, t, 0.02, 0.35, 2.6); sub.connect(sg); sg.connect(g);
      if (li >= 2 && !soft) key.chord.concat(key.chord.map((f) => f * 2)).slice(0, 4 + li * 2).forEach((f, i) => { const o = osc('triangle', f * 2, t + 0.12 + i * 0.07, 0.6); const og = ctx.createGain(); env(og, t + 0.12 + i * 0.07, 0.003, 0.05, 0.55); o.connect(og); og.connect(gain(1, 0.8)); });
      if (kind === 'knife') api.metal(2.1, at + 0.02, 0.18);
      if (level === 'godlike') api.choir(at, 4.5);
    },
    /** Хор: пилы через полосовые фильтры гласной «а». */
    choir(at = 0, dur = 4) {
      const t = now(at); const g = gain(0.0001, 0.9);
      const formants = [[730, 6, 1], [1090, 8, 0.5], [2440, 10, 0.25]].map(([f, q, v]) => { const bp = filt('bandpass', f, q); const fg = ctx.createGain(); fg.gain.value = v; bp.connect(fg); fg.connect(g); return bp; });
      const ch = key.chord, n = ch.length;
      for (const f of [ch[0], ch[2 % n], ch[4 % n], ch[0] * 2]) for (const det of [-11, 0, 11]) { const o = osc('sawtooth', f, t, dur, det); const vib = osc('sine', 5.2, t, dur); const vg = ctx.createGain(); vg.gain.value = 3; vib.connect(vg); vg.connect(o.detune); for (const bp of formants) o.connect(bp); }
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.6); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    },
    /** GODLIKE: уникальный стингер — хор, колокола и удар. */
    stinger(at = 0) {
      api.impact(1.35, at);
      [1, 1.5, 2, 3].forEach((p, i) => api.metal(p, at + i * 0.09, 0.16));
      api.choir(at + 0.05, 3.5);
    },
    /** Трещины реальности: хруст стекла/льда и низкий скрип. */
    crack(at = 0) {
      const t = now(at); const g = gain(1, 0.6);
      for (let i = 0; i < 9; i++) {
        const tt = t + Math.random() * 0.55 + i * 0.03; const bp = filt('bandpass', 2000 + Math.random() * 5000, 3);
        const ng = ctx.createGain(); env(ng, tt, 0.001, 0.25 + Math.random() * 0.3, 0.06 + Math.random() * 0.08); noise(tt, 0.2).connect(bp); bp.connect(ng); ng.connect(g);
      }
      const o = osc('sawtooth', 48, t, 0.9); o.frequency.linearRampToValueAtTime(38, t + 0.8); const lp = filt('lowpass', 300, 3); const og = ctx.createGain(); env(og, t, 0.1, 0.3, 0.7); o.connect(lp); lp.connect(og); og.connect(drive);
    },
    /** Разлёт осколков. */
    shatter(at = 0) {
      const t = now(at); const g = gain(1, 0.7);
      const hp = filt('highpass', 1800, 0.5); const ng = ctx.createGain(); env(ng, t, 0.003, 0.7, 0.9); noise(t, 1.2).connect(hp); hp.connect(ng); ng.connect(g);
      for (let i = 0; i < 12; i++) api.metal(2 + Math.random() * 3, at + Math.random() * 0.6, 0.05);
      api.stinger(at);
    },
    /** Нож: «шинг» клинка. */
    shing(at = 0, v = 1) {
      const t = now(at); const g = gain(1, 0.6);
      const bp = filt('bandpass', 2600, 9); bp.frequency.exponentialRampToValueAtTime(9500, t + 0.45); const ng = ctx.createGain(); env(ng, t, 0.01, 0.4 * v, 0.5); noise(t, 0.6).connect(bp); bp.connect(ng); ng.connect(g);
      const o = osc('sine', 2100, t, 0.8); o.frequency.exponentialRampToValueAtTime(4300, t + 0.5); const og = ctx.createGain(); env(og, t, 0.004, 0.05 * v, 0.7); o.connect(og); og.connect(g);
      api.metal(2.6, at + 0.01, 0.1 * v);
    },
    /** Перчатки: кожаный щелчок и мягкий «тканевый» взмах. */
    glove(at = 0, v = 1) {
      const t = now(at); const g = gain(1, 0.4);
      const lp = filt('lowpass', 1100, 1); const ng = ctx.createGain(); env(ng, t, 0.002, 0.45 * v, 0.1); noise(t, 0.2).connect(lp); lp.connect(ng); ng.connect(g);
      const o = osc('sine', 130, t, 0.3); o.frequency.exponentialRampToValueAtTime(58, t + 0.22); const og = ctx.createGain(); env(og, t, 0.003, 0.5 * v, 0.22); o.connect(og); og.connect(g);
      const bp = filt('bandpass', 380, 1.2); bp.frequency.exponentialRampToValueAtTime(1400, t + 0.5); const wg = ctx.createGain(); env(wg, t + 0.05, 0.25, 0.22 * v, 0.45); noise(t, 0.9).connect(bp); bp.connect(wg); wg.connect(g);
    },
    /** Пролёт камеры (стерео). */
    whoosh(dur = 0.8, at = 0) {
      const t = now(at); const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null; const g = gain(1, 0.4);
      const bp = filt('bandpass', 300, 1.4); bp.frequency.exponentialRampToValueAtTime(1600, t + dur * 0.5); bp.frequency.exponentialRampToValueAtTime(300, t + dur);
      const ng = ctx.createGain(); env(ng, t, dur * 0.5, 0.35, dur * 0.5); noise(t, dur + 0.1).connect(bp); bp.connect(ng);
      if (pan) { pan.pan.setValueAtTime(-0.8, t); pan.pan.linearRampToValueAtTime(0.8, t + dur); ng.connect(pan); pan.connect(g); } else ng.connect(g);
    },
    sparkle(at = 0) {
      for (let i = 0; i < 6; i++) { const f = key.chord[(Math.random() * key.chord.length) | 0] * 4; const t = now(at + i * 0.06 + Math.random() * 0.05); const o = osc('sine', f, t, 0.5); const og = ctx.createGain(); env(og, t, 0.002, 0.03, 0.45); o.connect(og); og.connect(gain(1, 0.9)); }
    },
    glint(at = 0) { const t = now(at); const o = osc('sine', 5200, t, 0.6); o.frequency.exponentialRampToValueAtTime(7800, t + 0.5); const og = ctx.createGain(); env(og, t, 0.15, 0.01, 0.4); o.connect(og); og.connect(gain(1, 0.9)); },
    /** Временно приглушить (вкладка в фоне). */
    mute(on) { const n = ctx.currentTime; out.gain.cancelScheduledValues(n); out.gain.setTargetAtTime(on ? 0 : OUT, n, 0.08); },
    stopAll(fade = 0.3) { for (const h of [...live]) { try { h.stop(fade); } catch { /* ignore */ } } },
    dispose() {
      api.stopAll(0.4);
      const n = ctx.currentTime; out.gain.setTargetAtTime(0, n + 2.5, 0.4);
      setTimeout(() => { try { out.disconnect(); wet.disconnect(); rev.disconnect(); } catch { /* ignore */ } }, 5000);
    },
  };
  return api;
}

let NB = null;
function noiseBuf(ctx) {
  if (NB && NB.sampleRate === ctx.sampleRate) return NB;
  const len = Math.floor(ctx.sampleRate * 2); NB = ctx.createBuffer(1, len, ctx.sampleRate); const d = NB.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return NB;
}
let IR = null;
function impulse(ctx, sec, decay) {
  if (IR && IR.sampleRate === ctx.sampleRate) return IR;
  const len = Math.floor(ctx.sampleRate * sec); IR = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = IR.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return IR;
}
