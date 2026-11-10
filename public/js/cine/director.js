// BURGER SKIN — кинодроп: режиссура. Состояние сцены — чистая функция времени T и пресета,
// поэтому пропуск, повтор и любая частота кадров дают одинаковую картинку. Разовые события
// (звуки, всплески частиц) — отдельный список «реплик» с временем срабатывания.
import { lerp, ss, eIn2, eOut3, eOutExpo, eInOut, eBack, spike, wobble, DEG } from './util.js';

/** Время энерговолн и световых импульсов (абсолютные секунды сцены). */
function beats(P, TL) {
  const I = P.I;
  const tA = TL.start('activate'), dA = TL.dur('activate'), tS = TL.start('suspense'), dS = TL.dur('suspense');
  const waveU = [[0.5], [0.2, 0.7], [0.12, 0.45, 0.8], [0.1, 0.35, 0.6, 0.85], [0.08, 0.28, 0.48, 0.68, 0.88]][Math.max(0, Math.min(4, I.waves - 1))];
  const waveT = waveU.map((u) => tA + dA * u);
  // Импульсы в ожидании ускоряются к раскрытию — «сердцебиение» сцены, между ними паузы.
  const pulseU = [[0.35], [0.2, 0.62], [0.12, 0.45, 0.72], [0.1, 0.38, 0.6, 0.78], [0.08, 0.32, 0.54, 0.7, 0.8]][Math.max(0, Math.min(4, I.pulses - 1))];
  const pulseT = pulseU.map((u) => tS + dS * u);
  return { waveT, pulseT };
}

export function makeScript(P, TL) {
  const { waveT, pulseT } = beats(P, TL);
  const I = P.I;
  const tR = TL.start('reveal'), dR = TL.dur('reveal');
  const cues = [];
  const at = (t, name, arg) => cues.push({ t, name, arg });
  at(0, 'ambience');
  at(0.02, 'dust');
  if (P.li >= 2) at(TL.dur('build') * 0.55, 'heartbeat', 0.55);
  if (P.li >= 3) at(TL.dur('build') * 0.85, 'heartbeat', 0.75);
  const tA = TL.start('activate');
  at(tA, P.li >= 1 ? 'portal' : 'swell');
  at(tA + 0.05, 'charge', TL.dur('activate') + TL.dur('suspense') * 0.6);
  if (P.li >= 1) at(tA + 0.1, 'vortex');
  for (const t of waveT) at(t, 'wave');
  if (P.kind === 'knife') { at(tA + TL.dur('activate') * 0.35, 'slash', 1); at(TL.start('suspense') + TL.dur('suspense') * 0.55, 'slash', -1); }
  if (P.kind === 'glove') { at(tA + TL.dur('activate') * 0.25, 'wisps'); at(TL.start('suspense') + TL.dur('suspense') * 0.3, 'wisps'); }
  const tS = TL.start('suspense'), dS = TL.dur('suspense');
  if (P.li >= 1) at(tS, 'riser', dS + (TL.has('shatter') ? TL.dur('shatter') * 0.45 : 0));
  for (const t of pulseT) at(t, 'pulse');
  at(tS + dS * 0.8, 'suck', dS * 0.2);
  if (I.blackout) at(TL.end('suspense') - 0.45, 'blackout');
  if (TL.has('shatter')) {
    const tX = TL.start('shatter'), dX = TL.dur('shatter');
    at(tX, 'crack');
    at(tX + dX * 0.5, 'shatter');
  }
  at(tR, 'reveal');
  if (P.kind === 'knife') at(tR + dR * 0.38, 'slash', 0);
  at(tR + dR * 0.55, 'final');
  return { cues, waveT, pulseT };
}

/** Замедление времени (только GODLIKE: предмет выходит из сверхновой в slow motion). */
export function speedAt(P, TL, T) {
  if (!P.I.slowmo) return 1;
  const rt = T - TL.start('reveal');
  if (rt < 0.03 || rt > 0.62) return 1;
  return lerp(1, 0.32, ss(0.03, 0.1, rt) * (1 - ss(0.42, 0.62, rt)));
}

const S0 = () => ({
  core: 0, fog: 0, spots: 0, rays: 0, rift: 0, slit: 0, swirl: 0, lightning: 0, distort: 0, pulse: 0, suck: 0,
  waves: [], floorWave: [0, 0], flash: 0, flashC: [1, 1, 1], shock: [0.5, 0.5, 0, 0], shake: 0, expo: 1,
  cam: { dist: 1.3, yaw: 0, pitch: 0.12, roll: 0, fov: 36, x: 0, y: 0 },
  item: { vis: 0, op: 0, emerge: 0, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, s: 1, white: 0 },
  plat: 0, halo: 0, dof: 0, sweep: -1, pillars: 0, prism: 0, crack: 0, shatter: 0, letterbox: 0,
  stage: 'build', revealed: false, final: false, chroma: 0, bloom: 1, dustLight: 0.3, emit: { vortex: 0, rise: 0, twinkle: 0, wisps: 0 },
});

export function evaluate(P, TL, script, T, S = S0()) {
  const I = P.I, rm = P.reduced;
  const b = TL.u('build', T), a = TL.u('activate', T), s = TL.u('suspense', T);
  const hasX = TL.has('shatter'), x = hasX ? TL.u('shatter', T) : 0;
  const r = TL.u('reveal', T);
  const tR = TL.start('reveal'), rt = T - tR, dR = TL.dur('reveal');
  const pre = T < tR;
  S.stage = TL.stageAt(T);
  S.revealed = !pre;
  S.final = T >= tR + dR * 0.55;

  let pulse = 0;
  for (const t of script.pulseT) pulse += spike(T - t, 0.04, 0.22);
  pulse = Math.min(1.2, pulse);
  S.pulse = pulse;
  const inhale = pre ? ss(0.78, 1, s) * (hasX ? 1 - ss(0, 0.3, x) : 1) : 0;
  S.suck = inhale + (hasX ? ss(0.1, 0.45, x) * (1 - ss(0.45, 0.55, x)) * 0.6 : 0);

  // Затемнение-пауза перед GODLIKE: свет почти гаснет, звук проваливается — затем разлом реальности.
  let blk = 0;
  if (I.blackout) {
    const tb = TL.end('suspense') - T;
    if (tb <= 0.45 && tb >= 0) blk = ss(0.45, 0.2, tb);
    if (hasX && T >= TL.start('shatter')) blk = 1 - ss(0.55, 0.9, x);
    if (!pre) blk = 0;
  }
  S.expo = 1 - 0.9 * blk;

  // Ядро энергии
  let core = 0.05 + 0.3 * eIn2(b) + 0.07 * b * (0.5 + 0.5 * Math.sin(T * 21) * Math.sin(T * 6.3));
  core += 0.65 * ss(0, 0.55, a) + pulse * 0.5 + inhale * 0.7;
  const nova = hasX ? ss(0.62, 1, x) * (pre ? 1 : 1 - ss(0, 0.5, r)) : 0;
  core += nova * 2.2;
  if (!pre) core = lerp(core, 0.25, ss(0, 0.5, r)) + 2.0 * spike(rt, 0.02, 0.22) * (rm ? 0.15 : 1) * (0.4 + P.intensity);
  S.core = core;

  // Разлом: узкая щель раскрывается в овальный портал, на вдохе сжимается, после раскрытия — ореол.
  let rift = I.rift * eBack(ss(0.05, 0.8, a), 1.25);
  rift *= 1 + 0.06 * Math.sin(T * 5.1) * s - 0.3 * inhale;
  if (hasX) rift *= 1 + 0.4 * ss(0.5, 1, x);
  if (!pre) rift *= 1 - 0.8 * ss(0, 0.45, r);
  S.rift = rift;
  S.slit = ss(0.1, 0.65, a);
  S.swirl = T * (0.4 + 1.6 * a + 1.5 * inhale);
  S.lightning = I.lightning * ss(0.35, 1, a) * (pre ? 1 : 1 - ss(0, 0.25, r)) * (0.65 + 0.35 * Math.sin(T * 13.7) * Math.sin(T * 5.3));

  S.rays = I.rays * (0.8 * ss(0.15, 1, a) + 0.35 * pulse + 0.5 * inhale + 1.2 * nova) * (pre ? 1 - blk : lerp(1, 0.26, ss(0.05, 0.7, r)));
  S.spots = I.spots * (0.12 * ss(0.2, 1, b) + 0.55 * ss(0, 0.8, a) - 0.4 * inhale + (pre ? 0 : 0.45 * ss(0.1, 0.7, r))) * (1 - blk);
  S.fog = I.fog * (0.3 + 0.45 * b + 0.25 * a - 0.32 * ss(0.2, 1, r));
  S.dustLight = 0.25 + 0.5 * S.spots + 0.3 * Math.min(1, core);
  S.distort = rm ? 0 : I.distort * (0.8 * ss(0.2, 1, a) + 0.25 * pulse + 0.7 * inhale) * (pre ? 1 : 1 - ss(0, 0.4, r));

  // Энерговолны (экран, вокруг разлома) и волна по полу при раскрытии.
  const waves = [];
  for (const t of script.waveT) {
    const age = T - t;
    if (age >= 0 && age < 1.7) waves.push([age * (0.55 + 0.1 * P.li), Math.pow(1 - age / 1.7, 2) * (0.6 + 0.12 * P.li)]);
  }
  if (!pre && rt < 2.2) waves.push([rt * (1.1 + 0.15 * P.li), Math.pow(1 - rt / 2.2, 2) * (rm ? 0.25 : 1.1)]);
  if (hasX) { const ax = T - (TL.start('shatter') + TL.dur('shatter') * 0.5); if (ax >= 0 && ax < 1.6) waves.push([ax * 1.4, Math.pow(1 - ax / 1.6, 2) * 1.2]); }
  S.waves = waves.slice(-5);
  S.floorWave = !pre && rt < 2.5 ? [rt * 3.2, Math.exp(-rt * 1.4) * (rm ? 0.3 : 1)] : [0, 0];

  // Вспышка и ударная волна раскрытия
  let flash = !pre ? I.flash * spike(rt, 0.025, 0.28) : 0;
  if (hasX && pre) flash += (rm ? 0.1 : 0.35) * spike(T - (TL.start('shatter') + TL.dur('shatter') * 0.5), 0.03, 0.16) + (rm ? 0.1 : 0.45) * ss(0.85, 1, x);
  S.flash = flash;
  S.flashC = P.level === 'godlike' ? [1, 0.96, 0.86] : [lerp(1, P.pal.b[0], 0.3), lerp(1, P.pal.b[1], 0.3), lerp(1, P.pal.b[2], 0.3)];
  S.shock = [0.5, 0.5, Math.max(0, rt) * 1.15, !pre && rt < 1.3 ? I.shock * Math.exp(-rt * 2.4) : 0];

  // Тряска камеры: рокот в активации/ожидании + удар при раскрытии
  let shake = I.shake * (0.1 * a + 0.28 * s * s + 0.35 * inhale) * (pre ? 1 : 0);
  if (hasX && pre) shake += I.shake * (0.25 * ss(0, 0.5, x) + 0.9 * spike(T - (TL.start('shatter') + TL.dur('shatter') * 0.5), 0.02, 0.35));
  if (!pre) shake += I.shake * 0.95 * spike(rt, 0.015, 0.4);
  S.shake = rm ? 0 : Math.min(1, shake);

  // Камера: отъезд → медленный наезд → удар-наезд при раскрытии → облёт на финале
  const cam = S.cam;
  const vz = rm ? 0 : I.vertigo * inhale;
  cam.fov = 36 + 10 * vz;
  if (pre) {
    cam.dist = 1.36 - 0.04 * b - 0.07 * a - (rm ? 0.05 : 0.17) * eInOut(s);
    if (hasX) cam.dist -= 0.04 * x;
  } else {
    const k = eOutExpo(rt / 1.25);
    cam.dist = lerp(hasX ? 1.04 : 1.08, 1.0, rm ? eOut3(r) : k) - (rm ? 0 : I.punch * spike(rt, 0.06, 0.35));
  }
  const idle = pre ? 0 : ss(0.6, 1, r);
  const tf = Math.max(0, rt);
  cam.yaw = (rm ? 0.2 : 1) * (pre ? 0.07 * Math.sin(T * 0.31) * (1 - inhale) : (I.orbit * 0.55 * DEG) * Math.sin(tf * 0.29 + 0.4) * idle);
  cam.pitch = 0.11 + (rm ? 0 : 0.02 * Math.sin(T * 0.43)) + (pre ? 0.03 * (1 - b) : 0);
  cam.roll = rm ? 0 : pre ? 0.012 * wobble(T * 0.5, 2) * (0.3 + I.shake) : 0;
  cam.x = 0; cam.y = 0;

  // Предмет: до раскрытия его нет совсем (ни силуэта, ни контура).
  const it = S.item;
  if (pre) {
    it.vis = 0; it.op = 0; it.emerge = 0; it.white = 0;
  } else {
    it.vis = 1; it.x = 0; it.y = 0;
    if (rm) {
      it.op = ss(0, 0.65, r); it.emerge = 1; it.s = lerp(0.96, 1, eOut3(r)); it.z = 0; it.rx = 0; it.ry = 0; it.rz = 0; it.white = 0;
    } else {
      it.op = 1;
      it.emerge = ss(0, 0.34, r);
      it.white = I.white * (1 - ss(0, 0.5, r));
      it.s = lerp(0.55, 1, eBack(ss(0, 0.6, r), 1.6));
      if (P.kind === 'knife') {
        // Нож: стремительное вращение клинка с торможением и «щелчком» в позицию
        it.z = -0.8 * (1 - eBack(ss(0, 0.6, r), 1.8));
        it.ry = -720 * DEG * (1 - eOutExpo(ss(0, 0.62, r)));
        it.rz = -22 * DEG * (1 - eOut3(ss(0.25, 0.9, r)));
        it.rx = 8 * DEG * (1 - eOut3(ss(0, 0.7, r)));
      } else if (P.kind === 'glove') {
        // Перчатки: поднимаются снизу с мягким покачиванием, без рывков
        it.y = -0.85 * (1 - eBack(ss(0, 0.75, r), 1.3));
        it.z = -0.45 * (1 - eOut3(ss(0, 0.7, r)));
        it.ry = 26 * DEG * (1 - eOut3(ss(0, 0.9, r)));
        it.rz = 9 * DEG * Math.sin(tf * 5) * Math.exp(-tf * 2.2);
        it.rx = -6 * DEG * (1 - eOut3(ss(0, 0.8, r)));
      } else {
        it.z = -1.0 * (1 - eBack(ss(0, 0.7, r), 2.0));
        it.ry = -32 * DEG * (1 - eOut3(ss(0, 0.85, r)));
        it.rx = 12 * DEG * (1 - eOut3(ss(0, 0.7, r)));
        it.rz = -5 * DEG * (1 - eOut3(ss(0, 0.8, r)));
      }
    }
    // Финальная витрина: медленное покачивание и «дыхание»
    const amp = rm ? 0.25 : 1;
    it.ry += idle * amp * I.orbit * 0.8 * DEG * Math.sin(tf * 0.52);
    it.rx += idle * amp * 2.5 * DEG * Math.sin(tf * 0.37 + 1);
    it.y += idle * amp * 0.035 * Math.sin(tf * 0.8);
    if (P.kind === 'glove') it.rz += idle * amp * 2 * DEG * Math.sin(tf * 0.61);
  }

  S.plat = 0.06 + 0.1 * Math.min(1, core) * (pre ? 1 : 0) + (pre ? 0 : 0.9 * ss(0.05, 0.45, r));
  S.halo = pre ? 0 : I.halo * ss(0.08, 0.6, r);
  S.dof = pre ? 0 : ss(0.3, 0.9, r) * (P.lite ? 0.6 : 1);
  S.pillars = pre ? 0 : I.pillars * ss(0.45, 1, r);
  S.prism = pre ? I.prism * (hasX ? ss(0.5, 1, x) : 0) * 0.8 : I.prism * lerp(0.5, 0.1, ss(0, 0.7, r));
  S.crack = hasX ? ss(0, 0.5, x) * (pre ? 1 : 1 - ss(0, 0.3, r)) : 0;
  S.shatter = hasX && !rm ? eIn2(ss(0.5, 0.95, x)) * (pre ? 1 : 1 - ss(0, 0.15, r)) : 0;
  S.letterbox = rm ? 0 : ss(0, 0.35, b) * (pre ? 1 : 1 - ss(0.35, 0.85, r));
  const ts = T - (tR + dR * 0.42);
  S.sweep = pre || ts < 0 ? -1 : ((ts % 5.2) / 1.3) * 1.9 - 0.3;
  S.chroma = rm ? 0 : P.post.chroma + flash * 0.004 + S.shock[3] * 0.003 + inhale * 0.002 + S.prism * 0.002;
  S.bloom = P.post.bloom * (1 + 0.5 * Math.min(1, flash) + 0.3 * pulse);
  // Непрерывные источники частиц
  S.emit.vortex = pre ? I.embers * (ss(0.1, 0.8, a) + inhale) : 0;
  S.emit.rise = pre ? 0 : I.embers * ss(0.3, 1, r);
  S.emit.twinkle = pre ? 0 : I.twinkle * ss(0.5, 1, r);
  S.emit.wisps = P.kind === 'glove' ? (pre ? 0.5 * a + 0.5 * s : ss(0.2, 1, r)) : 0;
  return S;
}

export { S0 as emptyState };
