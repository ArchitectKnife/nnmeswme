// BURGER SKIN — кинодроп: рендер WebGL2.
// Проходы за кадр:
//  1) ENV  → A (пониженное разрешение): дым и туман с параллаксом, объёмные прожекторы, лучи из разлома,
//     разлом (щель → портал, вихрь, нити энергии), энерговолны, ядро, глянцевый пол и подиум, колонны света;
//  2) частицы (инстансы, аддитивно) → A;  3) отражение предмета на подиуме → A;
//  4) COMBINE → C (полное разрешение): преломление вокруг разлома, разлом реальности (GODLIKE), глубина резкости;
//  5) ПРЕДМЕТ → C: настоящая картинка скина на квадрате в перспективе, нормали из альфы/яркости, металлический
//     блик, контровой свет, проявление из энергии;  6) FINAL → экран: bloom по mip-уровням, ударная волна,
//     хроматическая аберрация, вспышка, мягкий тонмаппинг, виньетка, зерно.
import { m4, clamp } from './util.js';
import { WORLD, project, itemModel } from './showcase.js';
import { STRIDE } from './particles.js';

const VS_TRI = `#version 300 es
layout(location=0) in vec2 aP; out vec2 vUv;
void main(){ vUv = aP * 0.5 + 0.5; gl_Position = vec4(aP, 0.0, 1.0); }`;

const NOISE = `
float h1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec2 h2(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), u.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), u.x), u.y); }
`;

const FS_ENV = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform float uAsp, uT, uEnc; uniform int uOct;
uniform vec3 uA, uB, uC, uBg, uSpotC;
uniform vec3 uCP, uCF, uCR, uCU; uniform float uTan;
uniform float uFloorY, uPlatR, uPlat;
uniform vec3 uRift; uniform float uOpen, uSlit, uSwirl, uLight;
uniform float uCore, uFog, uRays, uSpots, uPulse, uHalo, uPillars, uPrism, uExpo, uKnife;
uniform vec3 uHaloP;
uniform vec4 uWaves[5];
uniform vec2 uFW;
${NOISE}
const mat2 RM = mat2(1.6, 1.2, -1.2, 1.6);
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ if (i >= uOct) break; s += a * vn(p); p = RM * p; a *= 0.5; } return s; }
vec3 hue(float h){ return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
void main(){
  vec2 sp = (vUv - 0.5) * 2.0; sp.x *= uAsp;
  vec3 rd = normalize(uCF + uCR * sp.x * uTan + uCU * sp.y * uTan);
  float t = uT;
  vec3 col = uBg * (0.55 + 0.6 * vUv.y);
  vec2 rp = vUv - uRift.xy; rp.x *= uAsp;
  float rl = length(rp);
  float R = max(uRift.z, 1e-4);
  // Дым с параллаксом от поворота камеры: два слоя на разной глубине
  vec2 par = vec2(atan(uCF.x, -uCF.z), asin(clamp(uCF.y, -1.0, 1.0))) * 2.4;
  vec2 fp = sp * 0.75 + par;
  float f1 = fbm(fp * 1.1 + vec2(t * 0.035, -t * 0.012));
  float f2 = fbm(fp * 2.3 + f1 * 1.7 + vec2(-t * 0.05, t * 0.03) + par * 0.6);
  float smoke = smoothstep(0.3, 0.95, f1 * 0.62 + f2 * 0.55);
  float lit = 0.05 + uCore * 0.9 * exp(-rl * 1.4) + uSpots * 0.22 + uPulse * 0.3 * exp(-rl * 2.0);
  col += mix(uC, uA, f2) * smoke * uFog * lit * 0.9;
  // Объёмные прожекторы сверху
  float spots = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i) - 1.0;
    vec2 ap = vec2(fi * 1.3 * min(uAsp, 1.7), 1.4);
    vec2 tg = vec2(fi * 0.15, -0.45);
    vec2 dir = normalize(tg - ap); vec2 w = sp - ap;
    float along = dot(w, dir); float across = abs(dir.x * w.y - dir.y * w.x);
    float width = 0.04 + along * (uKnife > 0.5 ? 0.13 : 0.2);
    float cone = smoothstep(width, width * 0.1, across) * smoothstep(0.0, 0.3, along) * exp(-along * 0.55);
    spots += cone * (0.5 + 0.5 * fbm(vec2(along * 2.4 - t * 0.25, across * 8.0 + fi * 7.0)));
  }
  col += uSpotC * spots * uSpots * 0.5;
  // Лучи из разлома (god rays)
  float ang = atan(rp.y, rp.x);
  float rr = vn(vec2(ang * 6.0 + 11.0, t * 0.22)) * 0.6 + vn(vec2(ang * 17.0, -t * 0.35 + 4.0)) * 0.5;
  float rays = pow(clamp(rr, 0.0, 1.0), 3.0) * exp(-rl * 1.1) * smoothstep(R * 0.4, R * 1.15, rl);
  vec3 rayC = mix(uA, uB, 0.45);
  if (uPrism > 0.001) rayC = mix(rayC, hue(ang / 6.2832 + t * 0.05) * 1.1 + 0.25, clamp(uPrism, 0.0, 1.0) * 0.55);
  col += rayC * rays * uRays * (0.7 + smoke * 0.9) * 1.6;
  // Энергетическое ядро
  float coreG = exp(-rl * rl * 70.0) * 2.0 + exp(-rl * 5.5) * 0.45 + exp(-rl * 1.5) * 0.1;
  col += mix(uA, vec3(1.0), exp(-rl * 26.0)) * coreG * uCore;
  // Разлом: щель раскрывается в вертикальный овал; внутри — тёмная глубина с туманностью
  if (uOpen > 0.002 && rl < R * 3.2 + 0.05) {
    vec2 q = rp; q.x *= mix(5.5, 1.0, uSlit); q.y *= 0.8;
    float ql = length(q), qa = atan(q.y, q.x);
    float sw = qa + uSwirl + 0.22 / (ql / R + 0.12);
    vec2 cq = vec2(cos(sw), sin(sw)) * (ql / R);
    float n1 = fbm(cq * 2.2 + vec2(t * 0.35, -t * 0.2));
    float n2 = fbm(cq * 4.5 - n1 * 2.2 + t * 0.4);
    float er = R * uOpen * (0.88 + 0.28 * (n1 - 0.5) + 0.05 * sin(qa * 7.0 + t * 2.0));
    float d = ql - er;
    float inside = smoothstep(0.004, -0.012, d);
    float depth = clamp(1.0 - ql / max(er, 1e-4), 0.0, 1.0);
    vec3 voidC = uBg * 0.12 + mix(uC, uA, n2) * (0.1 + 0.75 * pow(1.0 - depth, 3.0)) * n2;
    float star = step(0.992, h1(floor(cq * 46.0))) * depth * (0.5 + 0.5 * sin(t * 6.0 + h1(floor(cq * 46.0)) * 40.0));
    voidC += uB * star * 1.2;
    col = mix(col, voidC, inside);
    float rw = 0.005 + R * 0.03 * uOpen;
    float rim = exp(-d * d / (rw * rw));
    float hot = exp(-d * d / (rw * rw * 0.12));
    float on = min(uOpen * 1.6, 1.0);
    col += (mix(uA, uB, n2) * 2.2 * rim + vec3(1.0) * hot * 1.3) * on;
    float cor = exp(-max(d, 0.0) * 8.0 / R) * (0.3 + 0.7 * n1) * step(0.0, d);
    col += uA * cor * on * 0.9;
    if (uLight > 0.001) {
      float ln = abs(fbm(cq * 3.0 + vec2(t * 2.3, t * 1.1)) - 0.5);
      float fil = smoothstep(0.03, 0.0, ln) * inside * (0.35 + depth);
      float ln2 = abs(vn(vec2(qa * 4.0 + t * 7.0, ql / R * 9.0 - t * 3.0)) - 0.5);
      float arc = smoothstep(0.035, 0.0, ln2) * exp(-max(d, 0.0) * 12.0 / R) * step(0.0, d);
      col += uB * (fil * 2.0 + arc * 1.4) * uLight;
    }
  }
  // Ореол за предметом (остаток портала на финале)
  if (uHalo > 0.001) {
    vec2 hp = vUv - uHaloP.xy; hp.x *= uAsp; float hl = length(hp);
    col += uA * exp(-hl * hl / (uHaloP.z * uHaloP.z) * 1.6) * uHalo * 0.45;
    col += mix(uA, uB, 0.5) * exp(-pow((hl - uHaloP.z * 1.12) / 0.004, 2.0)) * uHalo * 0.5;
  }
  // Энерговолны
  for (int i = 0; i < 5; i++) {
    vec4 wv = uWaves[i];
    if (wv.y <= 0.001) continue;
    float d = rl - wv.x;
    col += mix(uA, uB, 0.6) * exp(-d * d * (1400.0 / (1.0 + wv.x * 8.0))) * wv.y * 1.6;
    col += uA * exp(d * 7.0) * step(d, 0.0) * wv.y * 0.07;
  }
  // Глянцевый пол и подиум
  if (rd.y < -0.0005) {
    float tt = (uFloorY - uCP.y) / rd.y;
    if (tt > 0.0) {
      vec3 hp = uCP + rd * tt;
      float pr = length(hp.xz);
      float fd = exp(-tt * 0.06);
      vec3 fl = uBg * 0.22;
      fl += uA * exp(-pr * 0.6) * (0.06 + 0.22 * min(uCore, 2.0) + 0.3 * uPlat);
      float refl = exp(-abs(hp.x) * 2.6) * exp(-max(-hp.z - 0.9, 0.0) * 0.5) * (uCore * 0.22 + uOpen * 0.35);
      fl += mix(uA, uB, 0.5) * refl * 0.55 * exp(-pr * 0.2);
      fl += uB * smoothstep(0.985, 1.0, cos(pr * 7.0 - t * 0.6)) * exp(-pr * 0.3) * 0.1 * (0.4 * min(uCore, 1.5) + uPlat * 0.6);
      fl += mix(uC, uA, 0.5) * smoothstep(0.55, 0.95, fbm(hp.xz * 0.9 + vec2(t * 0.06, 0.0))) * exp(-pr * 0.25) * 0.12 * uFog;
      float inD = smoothstep(uPlatR * 1.004, uPlatR * 0.996, pr);
      if (inD > 0.0) {
        float pa = atan(hp.z, hp.x);
        vec3 metal = vec3(0.045, 0.05, 0.065) + (0.5 + 0.5 * sin(pr * 170.0)) * 0.03 * (0.4 + uPlat) + uB * 0.025;
        metal += uB * pow(abs(sin(pa + 0.6)), 10.0) * 0.07 * (0.3 + uPlat);
        fl = mix(fl, metal, inD);
        float ring = exp(-pow((pr - uPlatR * 0.9) / 0.012, 2.0));
        float ring2 = exp(-pow((pr - uPlatR * 0.55) / 0.005, 2.0)) * 0.5;
        float ticks = step(0.86, fract(pa * 36.0 / 6.2832 + t * 0.03)) * step(0.955, pr / uPlatR) * step(pr / uPlatR, 0.985);
        fl += (uA * ring * 3.2 + uB * ring2 + uB * ticks * 1.3) * uPlat;
        fl += uA * exp(-pr * pr * 3.0) * 0.45 * uPlat;
      }
      fl += uB * exp(-pow((pr - uPlatR) / 0.01, 2.0)) * (0.2 + 1.2 * uPlat);
      if (uFW.y > 0.001) { float dd = pr - uFW.x; fl += mix(uA, uB, 0.5) * exp(-dd * dd * 50.0) * uFW.y * 2.2; }
      col = mix(col, fl + col * 0.3, fd * smoothstep(0.0, 0.1, -rd.y));
    }
  }
  // Колонны света за подиумом (LEGENDARY / GODLIKE на финале)
  if (uPillars > 0.001) {
    vec2 d2 = normalize(rd.xz); float lxz = max(length(rd.xz), 1e-4);
    for (int i = 0; i < 5; i++) {
      float a = 3.4 + float(i) * 0.65;
      vec2 P = vec2(cos(a), sin(a)) * uPlatR * 1.45;
      vec2 o2 = uCP.xz - P;
      float tc = -dot(o2, d2);
      if (tc < 0.0) continue;
      float dist = length(o2 + d2 * tc);
      float y = uCP.y + rd.y * (tc / lxz) - uFloorY;
      float hgt = smoothstep(-0.05, 0.25, y) * exp(-max(y, 0.0) * 0.32);
      col += (mix(uA, uB, 0.55) * exp(-dist * dist * 700.0) * 1.4 + uA * exp(-dist * dist * 40.0) * 0.12) * hgt * uPillars;
    }
  }
  o = vec4(col * uExpo * uEnc, 1.0);
}`;

const FS_COMB = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uEnv; uniform float uAsp, uT, uDistort, uDof, uCrack, uShatter, uEnc; uniform int uTaps;
uniform vec3 uRift; uniform vec2 uFocus; uniform vec3 uCrackC;
${NOISE}
// Ячейки Вороного: x — расстояние до ребра, yz — центр ячейки
vec3 voro(vec2 p){
  vec2 n = floor(p), f = fract(p), mg = vec2(0.0), mr = vec2(0.0); float md = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) { vec2 g = vec2(float(i), float(j)); vec2 r = g + h2(n + g) - f; float d = dot(r, r); if (d < md) { md = d; mr = r; mg = g; } }
  md = 8.0;
  for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) { vec2 g = mg + vec2(float(i), float(j)); vec2 r = g + h2(n + g) - f; if (dot(mr - r, mr - r) > 1e-5) md = min(md, dot(0.5 * (mr + r), normalize(r - mr))); }
  return vec3(md, n + mg + h2(n + mg));
}
void main(){
  vec2 uv = vUv;
  vec2 d = uv - uRift.xy; d.x *= uAsp; float l = length(d);
  // Преломление вокруг разлома: свет «затягивает» к центру, с закруткой
  if (uDistort > 0.001) {
    float R = max(uRift.z, 0.02);
    float k = uDistort * R * R / (l * l + R * R * 0.6) * smoothstep(0.0, R * 0.7, l);
    vec2 dir = d / max(l, 1e-4);
    vec2 tw = vec2(-dir.y, dir.x);
    vec2 off = (dir * 0.05 + tw * 0.03 * sin(uT * 1.3)) * k;
    off.x /= uAsp; uv -= off;
  }
  vec3 crackL = vec3(0.0);
  if (uCrack > 0.001) {
    vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0) * 4.2;
    vec3 v = voro(p);
    vec2 cc = v.yz / 4.2;
    float front = smoothstep(uCrack * 1.6, uCrack * 1.6 - 0.25, length(cc));
    float gap = 0.012 + uShatter * 0.22;
    float crack = (1.0 - smoothstep(0.0, gap, v.x)) * front;
    float id = h1(v.yz * 7.13);
    vec2 cd = normalize(cc + 1e-3);
    vec2 off = cd * uShatter * (0.04 + id * 0.08);
    off.x /= uAsp;
    uv -= off * front;
    crackL = uCrackC * crack * (1.6 + uShatter * 3.5) + uCrackC * front * uShatter * 0.4;
  }
  vec3 c = texture(uEnv, uv).rgb;
  if (uDof > 0.001) {
    vec2 fd = uv - uFocus; fd.x *= uAsp;
    float w = uDof * smoothstep(0.1, 0.6, length(fd));
    float lod = 1.0 + w * 3.2;
    vec3 b = textureLod(uEnv, uv, lod).rgb;
    if (uTaps > 0) {
      vec2 px = exp2(lod) / vec2(textureSize(uEnv, 0));
      b = b * 0.4 + (textureLod(uEnv, uv + vec2(px.x, px.y) * 0.7, lod).rgb + textureLod(uEnv, uv - vec2(px.x, px.y) * 0.7, lod).rgb
        + textureLod(uEnv, uv + vec2(px.x, -px.y) * 0.7, lod).rgb + textureLod(uEnv, uv + vec2(-px.x, px.y) * 0.7, lod).rgb) * 0.15;
    }
    c = mix(c, b, smoothstep(0.0, 0.25, w));
  }
  o = vec4(c + crackL * uEnc, 1.0);
}`;

const VS_PART = `#version 300 es
layout(location=0) in vec2 aC;
layout(location=1) in vec3 iP; layout(location=2) in vec3 iV; layout(location=3) in float iS;
layout(location=4) in vec4 iCol; layout(location=5) in vec2 iT;
uniform mat4 uVP; uniform vec2 uRes; uniform float uPy;
out vec2 vC; out vec4 vCol; flat out int vType; out float vLen;
void main(){
  vec4 a = uVP * vec4(iP, 1.0);
  if (a.w < 0.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vC = aC; vCol = vec4(0.0); vType = 0; vLen = 1.0; return; }
  vec4 b = uVP * vec4(iP - iV, 1.0);
  vec2 sa = a.xy / a.w * 0.5 * uRes; vec2 sb = (b.w > 0.05 ? b.xy / b.w : a.xy / a.w) * 0.5 * uRes;
  float px = max(iS * uPy * 0.5 * uRes.y / a.w, 0.9);
  int type = int(iT.x + 0.5);
  vec2 ctr, ax, ay; float len = 1.0;
  if (type == 1 || type == 3) {
    vec2 dv = sa - sb; float L = length(dv); vec2 dn = L > 0.5 ? dv / L : vec2(1.0, 0.0);
    ctr = (sa + sb) * 0.5; ax = dn * (L * 0.5 + px); ay = vec2(-dn.y, dn.x) * px; len = (L * 0.5 + px) / px;
  } else {
    float c = cos(iT.y), s = sin(iT.y); float k = type == 4 ? 2.2 : 1.0;
    ctr = sa; ax = vec2(c, s) * px * k; ay = vec2(-s, c) * px;
  }
  vec2 sp = ctr + ax * aC.x + ay * aC.y;
  gl_Position = vec4(sp / (0.5 * uRes), 0.0, 1.0);
  vC = aC; vCol = iCol; vType = type; vLen = len;
  // мелкие частицы не исчезают при субпиксельном размере — гасим яркость пропорционально
  if (iS * uPy * 0.5 * uRes.y / a.w < 0.9) vCol.a *= iS * uPy * 0.5 * uRes.y / a.w / 0.9;
}`;

const FS_PART = `#version 300 es
precision highp float;
in vec2 vC; in vec4 vCol; flat in int vType; in float vLen;
uniform float uEnc;
out vec4 o;
void main(){
  float x = vC.x, y = vC.y, r2 = x * x + y * y, a = 0.0; vec3 c = vCol.rgb;
  if (vType == 0) a = exp(-r2 * 5.0) + exp(-r2 * 40.0) * 0.8;
  else if (vType == 1) { float head = smoothstep(-1.0, 1.0, x); a = exp(-y * y * 5.0) * smoothstep(1.0, 0.75, abs(x)) * (0.3 + 0.7 * head); c = mix(c, vec3(1.0), head * 0.5); }
  else if (vType == 2) {
    vec2 p = vC; float tri = max(abs(p.x) * 0.866 + p.y * 0.5, -p.y) - 0.55;
    a = smoothstep(0.06, -0.02, tri); float edge = smoothstep(0.1, 0.0, abs(tri));
    c = c * (0.55 + 0.45 * (p.x + 1.0) * 0.5) + vec3(1.0) * edge * 0.6;
  }
  else if (vType == 3) { a = exp(-y * y * 9.0) * pow(1.0 - abs(x), 0.6) * smoothstep(1.0, 0.2, abs(x)); c = mix(c, vec3(1.0), exp(-y * y * 30.0)); }
  else if (vType == 4) a = exp(-(x * x * 2.0 + y * y * 3.5)) * 0.8;
  else { a = exp(-abs(x) * 10.0) * exp(-y * y * 3.0) + exp(-abs(y) * 10.0) * exp(-x * x * 3.0) + exp(-r2 * 14.0) * 0.8; }
  if (a < 0.002) discard;
  o = vec4(c * a * vCol.a * uEnc, 0.0);
}`;

const VS_ITEM = `#version 300 es
layout(location=0) in vec2 aP;
uniform mat4 uM, uVP; uniform vec2 uSize; uniform float uZ;
out vec2 vUv; out vec3 vW;
void main(){
  vec4 w = uM * vec4(aP.x * uSize.x, aP.y * uSize.y, uZ, 1.0);
  vW = w.xyz; vUv = vec2(aP.x + 0.5, aP.y + 0.5);
  gl_Position = uVP * w;
}`;

const FS_ITEM = `#version 300 es
precision highp float;
in vec2 vUv; in vec3 vW; out vec4 o;
uniform sampler2D uImg; uniform vec2 uTexel; uniform mat3 uNM; uniform vec3 uCam, uKeyDir, uSpecDir, uKeyC, uRimC, uEdgeC;
uniform float uSweep, uEmerge, uWhite, uOp, uRefl, uFloorY, uSpecK, uRimK, uLayer, uEnc;
${NOISE}
float lum(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
float hgt(vec2 uv){ vec4 t = texture(uImg, uv); return t.a * (0.55 + 0.45 * lum(t.rgb)); }
void main(){
  vec4 t = texture(uImg, vUv);
  float a = t.a;
  if (a < 0.004) discard;
  vec2 e = uTexel * 2.0;
  float hl = hgt(vUv - vec2(e.x, 0.0)), hr = hgt(vUv + vec2(e.x, 0.0)), hd = hgt(vUv - vec2(0.0, e.y)), hu = hgt(vUv + vec2(0.0, e.y));
  vec3 nL = normalize(vec3((hl - hr) * 2.2, (hd - hu) * 2.2, 1.0));
  vec3 N = normalize(uNM * nL);
  vec3 V = normalize(uCam - vW);
  if (dot(N, V) < 0.0) N = -N;
  float dif = max(dot(N, uKeyDir), 0.0);
  vec3 H = normalize(uSpecDir + V);
  float L = lum(t.rgb);
  float metal = 0.35 + 0.65 * smoothstep(0.2, 0.85, L);
  float spec = pow(max(dot(N, H), 0.0), 42.0) * metal;
  float edge = clamp(length(vec2(hl - hr, hd - hu)) * 2.4, 0.0, 1.0);
  float band = vUv.x + (1.0 - vUv.y) * 0.35 - uSweep;
  float sheen = exp(-band * band * 70.0) * (0.25 + L);
  vec3 col = t.rgb * (0.8 + 0.3 * dif) + uKeyC * spec * uSpecK + uRimC * edge * uRimK + vec3(1.0) * sheen * 0.5 * uSpecK;
  if (uEmerge < 0.999) {
    float n = vn(vUv * 9.0) * 0.6 + vn(vUv * 23.0) * 0.4;
    float dc = length((vUv - 0.5) * vec2(1.3, 1.0));
    float m = uEmerge * 1.65 - dc - n * 0.45;
    a *= smoothstep(0.0, 0.04, m);
    col += uEdgeC * (1.0 - smoothstep(0.0, 0.12, m)) * 3.0;
  }
  col = mix(col, vec3(1.7), uWhite);
  col *= uLayer;
  if (uRefl > 0.5) { float dy = max(uFloorY - vW.y, 0.0); a *= exp(-dy * 2.4) * 0.34; col *= 0.8; }
  a *= uOp;
  o = vec4(col * a * uEnc, a);
}`;

const FS_FIN = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 o;
uniform sampler2D uC; uniform float uAsp, uT, uBloom, uThr, uChroma, uFlash, uVig, uGrain, uExpo, uPrism, uEnc;
uniform vec4 uShock; uniform vec3 uFlashC; uniform vec2 uRes;
vec3 hue(float h){ return clamp(abs(fract(h + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0) - 1.0, 0.0, 1.0); }
vec3 bl(vec2 uv, float lod){ return max(textureLod(uC, uv, lod).rgb / uEnc - uThr, 0.0); }
float h1(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
void main(){
  vec2 uv = vUv;
  if (uShock.w > 0.001) {
    vec2 d = uv - uShock.xy; d.x *= uAsp; float l = length(d); float x = l - uShock.z;
    float band = exp(-x * x * 500.0);
    vec2 dir = d / max(l, 1e-4); dir.x /= uAsp;
    uv -= dir * band * uShock.w * 0.03;
  }
  vec2 cd = uv - 0.5;
  float ch = uChroma * (1.0 + 2.0 * dot(cd, cd));
  vec3 c = vec3(texture(uC, uv + cd * ch).r, texture(uC, uv).g, texture(uC, uv - cd * ch).b) / uEnc;
  vec3 b = bl(uv, 1.5) * 0.3 + bl(uv, 3.0) * 0.5 + bl(uv, 4.5) * 0.7 + bl(uv, 6.0) * 0.85;
  if (uPrism > 0.001) b *= mix(vec3(1.0), 0.5 + hue(atan(cd.y, cd.x) / 6.2832 + length(cd) * 1.5 - uT * 0.08) * 1.0, clamp(uPrism, 0.0, 1.0) * 0.6);
  c += b * uBloom + uFlashC * uFlash;
  c *= uExpo;
  // Мягкое плечо: до 0.8 цвета предмета не искажаются, выше — плавно к белому
  vec3 sh = 0.8 + 0.2 * (1.0 - exp(-(c - 0.8) * 5.0));
  c = mix(c, sh, step(0.8, c));
  vec2 q = vUv - 0.5; q.x *= mix(1.0, uAsp, 0.55);
  c *= mix(1.0, smoothstep(0.95, 0.2, length(q)), uVig);
  c += (h1(vUv * uRes + fract(uT * 7.0) * 113.0) - 0.5) * uGrain;
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

export function createGL(canvas) {
  let gl = null;
  try { gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' }); } catch { gl = null; }
  if (!gl) return null;
  let hdr = !!gl.getExtension('EXT_color_buffer_float');
  const anisoExt = gl.getExtension('EXT_texture_filter_anisotropic');
  const res = { progs: [], bufs: [], vaos: [], texs: [], fbs: [] };
  const sh = (type, src) => {
    const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error('shader: ' + log); }
    return s;
  };
  const prog = (vs, fs) => {
    const p = gl.createProgram();
    const a = sh(gl.VERTEX_SHADER, vs), b = sh(gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, a); gl.attachShader(p, b); gl.linkProgram(p);
    gl.deleteShader(a); gl.deleteShader(b);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) throw new Error('link: ' + gl.getProgramInfoLog(p));
    res.progs.push(p);
    const loc = {};
    return { p, u: (n) => (n in loc ? loc[n] : (loc[n] = gl.getUniformLocation(p, n))) };
  };
  let P;
  try {
    P = { env: prog(VS_TRI, FS_ENV), comb: prog(VS_TRI, FS_COMB), part: prog(VS_PART, FS_PART), item: prog(VS_ITEM, FS_ITEM), fin: prog(VS_TRI, FS_FIN) };
  } catch (e) {
    console.warn('[cine] WebGL2 недоступен для сцены:', e?.message || e);
    try { gl.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* ignore */ }
    return null;
  }
  // Геометрия
  const tri = gl.createVertexArray(); gl.bindVertexArray(tri);
  const tb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, tb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const quadV = new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]);
  const pvao = gl.createVertexArray(); gl.bindVertexArray(pvao);
  const qb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb); gl.bufferData(gl.ARRAY_BUFFER, quadV, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib); let ibCap = 0;
  const bs = STRIDE * 4;
  const attr = (loc, n, off) => { gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, n, gl.FLOAT, false, bs, off * 4); gl.vertexAttribDivisor(loc, 1); };
  attr(1, 3, 0); attr(2, 3, 3); attr(3, 1, 6); attr(4, 4, 7); attr(5, 2, 11);
  const ivao = gl.createVertexArray(); gl.bindVertexArray(ivao);
  const qb2 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, qb2); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  res.vaos.push(tri, pvao, ivao); res.bufs.push(tb, qb, ib, qb2);

  // Рендер-цели с mip-уровнями (bloom и глубина резкости берутся из mip)
  let A = null, C = null;
  const target = (w, h) => {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    const levels = Math.floor(Math.log2(Math.max(w, h))) + 1;
    gl.texStorage2D(gl.TEXTURE_2D, levels, hdr ? gl.RGBA16F : gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const fb = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!ok) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); return null; }
    return { tex, fb, w, h };
  };
  const drop = (t) => { if (t) { gl.deleteFramebuffer(t.fb); gl.deleteTexture(t.tex); } };

  let item = null; // { tex, w, h, asp }
  let lost = false;
  const R = {
    kind: 'gl',
    get lost() { return lost || gl.isContextLost(); },
    get hdr() { return hdr; },
    resize(W, H, envScale) {
      W = Math.max(2, W | 0); H = Math.max(2, H | 0);
      canvas.width = W; canvas.height = H;
      const ew = Math.max(2, Math.round(W * envScale)), eh = Math.max(2, Math.round(H * envScale));
      drop(A); drop(C);
      A = target(ew, eh); C = target(W, H);
      if ((!A || !C) && hdr) { drop(A); drop(C); hdr = false; A = target(ew, eh); C = target(W, H); }
      if (!A || !C) throw new Error('framebuffer');
    },
    setItem(img) {
      if (item) { gl.deleteTexture(item.tex); item = null; }
      if (!img || !img.naturalWidth) return;
      const tex = gl.createTexture();
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      try { gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); } catch (e) { gl.deleteTexture(tex); gl.activeTexture(gl.TEXTURE0); console.warn('[cine] texture', e); return; }
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      if (anisoExt) gl.texParameterf(gl.TEXTURE_2D, anisoExt.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, gl.getParameter(anisoExt.MAX_TEXTURE_MAX_ANISOTROPY_EXT)));
      gl.activeTexture(gl.TEXTURE0);
      item = { tex, w: img.naturalWidth, h: img.naturalHeight, asp: img.naturalWidth / img.naturalHeight };
    },
    get itemAsp() { return item ? item.asp : 4 / 3; },
    render(F) {
      if (R.lost || !A || !C) return false;
      const { S, P, cam, Q, T } = F;
      const enc = hdr ? 1 : 0.5;
      const pal = P.pal;
      const riftS = project(cam, WORLD.rift);
      const edgeS = project(cam, [WORLD.rift[0] + 1, WORLD.rift[1], WORLD.rift[2]]);
      const riftR = Math.abs(edgeS[0] - riftS[0]) * cam.asp * P.I.riftR * 1.6;
      const itemS = project(cam, [S.item.x, S.item.y, S.item.z]);
      const itemE = project(cam, [S.item.x + cam.IW * 0.5, S.item.y, S.item.z]);
      const haloR = Math.abs(itemE[0] - itemS[0]) * cam.asp * 0.95;

      // 1) окружение
      gl.bindFramebuffer(gl.FRAMEBUFFER, A.fb); gl.viewport(0, 0, A.w, A.h);
      gl.disable(gl.BLEND);
      const pe = Pg.env; gl.useProgram(pe.p); gl.bindVertexArray(tri);
      gl.uniform1f(pe.u('uAsp'), cam.asp); gl.uniform1f(pe.u('uT'), T); gl.uniform1f(pe.u('uEnc'), enc); gl.uniform1i(pe.u('uOct'), Q.oct);
      gl.uniform3fv(pe.u('uA'), pal.a); gl.uniform3fv(pe.u('uB'), pal.b); gl.uniform3fv(pe.u('uC'), pal.c); gl.uniform3fv(pe.u('uBg'), pal.bg); gl.uniform3fv(pe.u('uSpotC'), P.spot);
      gl.uniform3fv(pe.u('uCP'), cam.pos); gl.uniform3fv(pe.u('uCF'), cam.f); gl.uniform3fv(pe.u('uCR'), cam.r); gl.uniform3fv(pe.u('uCU'), cam.u); gl.uniform1f(pe.u('uTan'), cam.tan);
      gl.uniform1f(pe.u('uFloorY'), WORLD.floorY); gl.uniform1f(pe.u('uPlatR'), WORLD.platR); gl.uniform1f(pe.u('uPlat'), S.plat);
      gl.uniform3f(pe.u('uRift'), riftS[0], riftS[1], riftR); gl.uniform1f(pe.u('uOpen'), S.rift); gl.uniform1f(pe.u('uSlit'), S.slit); gl.uniform1f(pe.u('uSwirl'), S.swirl); gl.uniform1f(pe.u('uLight'), S.lightning);
      gl.uniform1f(pe.u('uCore'), S.core); gl.uniform1f(pe.u('uFog'), S.fog); gl.uniform1f(pe.u('uRays'), S.rays); gl.uniform1f(pe.u('uSpots'), S.spots); gl.uniform1f(pe.u('uPulse'), S.pulse);
      gl.uniform1f(pe.u('uHalo'), S.halo); gl.uniform3f(pe.u('uHaloP'), itemS[0], itemS[1], haloR); gl.uniform1f(pe.u('uPillars'), S.pillars); gl.uniform1f(pe.u('uPrism'), S.prism); gl.uniform1f(pe.u('uExpo'), S.expo);
      gl.uniform1f(pe.u('uKnife'), P.kind === 'knife' ? 1 : 0);
      const wv = new Float32Array(20);
      S.waves.forEach((w, i) => { wv[i * 4] = w[0]; wv[i * 4 + 1] = w[1]; });
      gl.uniform4fv(pe.u('uWaves[0]'), wv);
      gl.uniform2f(pe.u('uFW'), S.floorWave[0], S.floorWave[1]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 2) частицы
      const n = F.np | 0;
      if (n > 0) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE);
        const pp = Pg.part; gl.useProgram(pp.p); gl.bindVertexArray(pvao);
        gl.bindBuffer(gl.ARRAY_BUFFER, ib);
        const need = F.pbuf.length * 4;
        if (ibCap < need) { gl.bufferData(gl.ARRAY_BUFFER, need, gl.DYNAMIC_DRAW); ibCap = need; }
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, F.pbuf, 0, n * STRIDE);
        gl.uniformMatrix4fv(pp.u('uVP'), false, cam.vp); gl.uniform2f(pp.u('uRes'), A.w, A.h); gl.uniform1f(pp.u('uPy'), cam.proj[5]); gl.uniform1f(pp.u('uEnc'), enc * S.expo);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, n);
      }

      // 3) отражение предмета на подиуме
      const showItem = item && S.item.vis > 0.001 && S.item.op > 0.001;
      const M = showItem ? itemModel(S, F.drag) : null;
      if (showItem && S.plat > 0.05) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        drawItem(m4.mirrorY(M, WORLD.floorY - 0.0), F, cam, enc, true, 1, 0);
      }
      gl.disable(gl.BLEND);

      // 4) сведение: преломление, разлом реальности, глубина резкости
      gl.bindFramebuffer(gl.FRAMEBUFFER, C.fb); gl.viewport(0, 0, C.w, C.h);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, A.tex); gl.generateMipmap(gl.TEXTURE_2D);
      const pc = Pg.comb; gl.useProgram(pc.p); gl.bindVertexArray(tri);
      gl.uniform1i(pc.u('uEnv'), 0); gl.uniform1f(pc.u('uAsp'), cam.asp); gl.uniform1f(pc.u('uT'), T); gl.uniform1f(pc.u('uEnc'), enc);
      gl.uniform1f(pc.u('uDistort'), Q.refract ? S.distort : 0); gl.uniform1f(pc.u('uDof'), S.dof); gl.uniform1i(pc.u('uTaps'), Q.taps);
      gl.uniform3f(pc.u('uRift'), riftS[0], riftS[1], riftR); gl.uniform2f(pc.u('uFocus'), itemS[0], itemS[1]);
      gl.uniform1f(pc.u('uCrack'), S.crack); gl.uniform1f(pc.u('uShatter'), S.shatter);
      gl.uniform3f(pc.u('uCrackC'), pal.b[0] * 1.1, pal.b[1] * 1.05, pal.b[2]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      // 5) предмет (с «толщиной» из нескольких слоёв при повороте)
      if (showItem) {
        gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        const turn = Math.abs(Math.sin(S.item.ry + (F.drag ? F.drag[0] : 0)));
        if (Q.thick > 0 && turn > 0.12) for (let i = Q.thick; i >= 1; i--) drawItem(M, F, cam, enc, false, 0.32, -0.012 * i);
        drawItem(M, F, cam, enc, false, 1, 0);
        gl.disable(gl.BLEND);
      }

      // 6) финал на экран
      gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, C.tex); gl.generateMipmap(gl.TEXTURE_2D);
      const pf = Pg.fin; gl.useProgram(pf.p); gl.bindVertexArray(tri);
      gl.uniform1i(pf.u('uC'), 0); gl.uniform1f(pf.u('uAsp'), cam.asp); gl.uniform1f(pf.u('uT'), T); gl.uniform1f(pf.u('uEnc'), enc);
      gl.uniform1f(pf.u('uBloom'), S.bloom * Q.bloomK); gl.uniform1f(pf.u('uThr'), P.post.thr); gl.uniform1f(pf.u('uChroma'), Q.chroma ? S.chroma : 0);
      gl.uniform1f(pf.u('uFlash'), S.flash); gl.uniform3fv(pf.u('uFlashC'), S.flashC); gl.uniform1f(pf.u('uVig'), P.post.vig); gl.uniform1f(pf.u('uGrain'), P.post.grain);
      gl.uniform1f(pf.u('uExpo'), P.post.expo); gl.uniform1f(pf.u('uPrism'), S.prism); gl.uniform2f(pf.u('uRes'), canvas.width, canvas.height);
      const sh0 = S.shock;
      gl.uniform4f(pf.u('uShock'), itemS[0], itemS[1], sh0[2], sh0[3]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindVertexArray(null);
      return true;
    },
    destroy() {
      try {
        if (item) gl.deleteTexture(item.tex);
        drop(A); drop(C);
        for (const p of res.progs) gl.deleteProgram(p);
        for (const b of res.bufs) gl.deleteBuffer(b);
        for (const v of res.vaos) gl.deleteVertexArray(v);
        gl.getExtension('WEBGL_lose_context')?.loseContext();
      } catch { /* ignore */ }
      item = null; A = null; C = null; lost = true;
    },
  };
  const Pg = P;

  function drawItem(M, F, cam, enc, refl, layer, z) {
    const { S, P } = F;
    const pi = Pg.item; gl.useProgram(pi.p); gl.bindVertexArray(ivao);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, item.tex);
    gl.uniform1i(pi.u('uImg'), 1);
    gl.uniformMatrix4fv(pi.u('uM'), false, M); gl.uniformMatrix4fv(pi.u('uVP'), false, cam.vp);
    gl.uniform2f(pi.u('uSize'), cam.IW, cam.IW / item.asp); gl.uniform1f(pi.u('uZ'), z);
    gl.uniform2f(pi.u('uTexel'), 1 / item.w, 1 / item.h);
    const s = Math.hypot(M[0], M[1], M[2]) || 1;
    gl.uniformMatrix3fv(pi.u('uNM'), false, new Float32Array([M[0] / s, M[1] / s, M[2] / s, M[4] / s, M[5] / s, M[6] / s, M[8] / s, M[9] / s, M[10] / s]));
    gl.uniform3fv(pi.u('uCam'), cam.pos);
    const sw = clamp(S.sweep, -1, 2);
    gl.uniform3f(pi.u('uKeyDir'), -0.45, 0.6, 0.66);
    gl.uniform3f(pi.u('uSpecDir'), (sw - 0.5) * 1.6, 0.35, 0.75);
    const kc = P.kind === 'knife' ? [1, 1, 1] : [lerp1(P.pal.b[0]), lerp1(P.pal.b[1]), lerp1(P.pal.b[2])];
    gl.uniform3fv(pi.u('uKeyC'), kc); gl.uniform3fv(pi.u('uRimC'), P.pal.a); gl.uniform3fv(pi.u('uEdgeC'), P.pal.b);
    gl.uniform1f(pi.u('uSweep'), sw); gl.uniform1f(pi.u('uEmerge'), S.item.emerge); gl.uniform1f(pi.u('uWhite'), refl ? 0 : S.item.white);
    gl.uniform1f(pi.u('uOp'), S.item.op * (refl ? S.plat : 1)); gl.uniform1f(pi.u('uRefl'), refl ? 1 : 0); gl.uniform1f(pi.u('uFloorY'), WORLD.floorY);
    gl.uniform1f(pi.u('uSpecK'), P.kind === 'knife' ? 1.0 : 0.75); gl.uniform1f(pi.u('uRimK'), 0.5 + 0.35 * P.intensity); gl.uniform1f(pi.u('uLayer'), layer); gl.uniform1f(pi.u('uEnc'), enc * (refl ? 1 : 1));
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.activeTexture(gl.TEXTURE0);
  }
  const lerp1 = (v) => 0.6 + 0.4 * v;

  canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); lost = true; R.onLost?.(); }, { once: true });
  return R;
}
