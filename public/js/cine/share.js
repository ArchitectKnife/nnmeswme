// BURGER SKIN — «Поделиться дропом»: ссылка /drop/<токен> и картинка-превью 1200×630.
// Данные карточки — только из уже записанного сервером дропа; картинка предмета — настоящая (или её нет).
import { html, mount, rub, WEARS, splitName, state, safeUrl } from '../core.js';
import { icon } from '../icons.js';
import { normFx, LEVEL_META, KIND_META } from '../cine-mode.js';
import { hex, rgba, TAU, preload } from './util.js';

const SHARE_TG = ['https:', '', 't.me', 'share', 'url'].join('/');
const SHARE_VK = ['https:', '', 'vk.com', 'share.php'].join('/');
const FONT = 'Inter, "Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

function palette(fx) {
  const f = normFx(fx) || normFx({ level: 'epic' });
  const m = LEVEL_META[f.level], k = f.kind ? KIND_META[f.kind] : null;
  return { a: hex(k && f.level !== 'godlike' ? k.a : m.a), b: hex(m.b), label: f.label };
}

async function shareImage(item, fx) {
  const W = 1200, H = 630;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const pal = palette(fx);
  const bg = g.createLinearGradient(0, 0, W, H); bg.addColorStop(0, '#0b0d12'); bg.addColorStop(1, rgba(pal.a.map((x) => x * 0.12), 1));
  g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const gx = 850, gy = 300;
  g.save(); g.globalCompositeOperation = 'lighter'; g.translate(gx, gy);
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU + 0.1, w = 0.04 + (i % 3) * 0.02, l = 900;
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, l); grd.addColorStop(0, rgba(pal.b, 0.18)); grd.addColorStop(1, rgba(pal.b, 0));
    g.fillStyle = grd; g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a - w) * l, Math.sin(a - w) * l); g.lineTo(Math.cos(a + w) * l, Math.sin(a + w) * l); g.closePath(); g.fill();
  }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, 420); gr.addColorStop(0, rgba(pal.a, 0.55)); gr.addColorStop(0.5, rgba(pal.a, 0.14)); gr.addColorStop(1, rgba(pal.a, 0));
  g.fillStyle = gr; g.fillRect(-600, -600, 1200, 1200);
  g.restore();
  const src = safeUrl(item.image, '');
  const { img, ok } = await preload(src, 2500);
  if (ok && img?.naturalWidth) {
    const bw = 560, bh = 400, r = Math.min(bw / img.naturalWidth, bh / img.naturalHeight), w = img.naturalWidth * r, h = img.naturalHeight * r;
    g.save(); g.shadowColor = rgba(pal.a, 0.75); g.shadowBlur = 50; g.drawImage(img, gx - w / 2, gy - h / 2, w, h); g.restore();
  }
  const fit = (t, max, size, weight) => {
    let s = size;
    for (; s > 18; s -= 2) { g.font = `${weight} ${s}px ${FONT}`; if (g.measureText(t).width <= max) return t; }
    while (t.length > 3 && g.measureText(t).width > max) t = t.slice(0, -2) + '…';
    return t;
  };
  const site = state.site?.site?.name || state.site?.name || 'BURGER SKIN';
  const [weapon, skin] = splitName(item.name || '');
  g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,255,255,.6)'; g.font = `800 26px ${FONT}`; g.fillText(String(site).toUpperCase(), 64, 78);
  const title = fit(pal.label, 560, 84, 900);
  const tg = g.createLinearGradient(64, 120, 64, 220); tg.addColorStop(0, rgba(pal.b, 1)); tg.addColorStop(1, rgba(pal.a, 1));
  g.fillStyle = tg; g.shadowColor = rgba(pal.a, 0.6); g.shadowBlur = 24; g.fillText(title, 64, 200); g.shadowBlur = 0;
  g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText(fit(skin ? weapon.replace(/^★\s*/, '') : '', 560, 30, 700), 64, 268);
  g.fillStyle = '#fff'; g.fillText(fit(skin || weapon, 560, 48, 800), 64, 326);
  const meta = [item.phase, item.wear && WEARS[item.wear], item.float != null && item.float !== '' ? 'Float ' + Number(item.float).toFixed(4) : '', item.stattrak ? 'StatTrak™' : '', item.souvenir ? 'Сувенир' : ''].filter(Boolean).join(' · ');
  if (meta) { g.fillStyle = 'rgba(255,255,255,.6)'; g.fillText(fit(meta, 560, 26, 600), 64, 372); }
  g.fillStyle = '#FFB627'; g.fillText(fit(rub(Number(item.price) || 0), 560, 64, 900), 64, 470);
  g.fillStyle = 'rgba(255,255,255,.45)'; g.font = `600 22px ${FONT}`; g.fillText('Честный дроп · результат определён сервером · Provably Fair', 64, 566);
  g.fillStyle = rgba(pal.a, 1); g.fillRect(0, H - 8, W, 8);
  return new Promise((res) => { try { cv.toBlob((b) => res(b), 'image/png'); } catch { res(null); } });
}

export async function openShare({ item, fx, share } = {}, ensureCss = null) {
  if (!item || !share) return;
  if (ensureCss) await ensureCss();
  document.querySelector('.cine-sharebox')?.remove();
  const url = `${location.origin}/drop/${encodeURIComponent(share)}`;
  const site = state.site?.site?.name || state.site?.name || 'BURGER SKIN';
  const label = normFx(fx)?.label || 'Мой дроп';
  const text = `${label}: ${item.name} — ${rub(Number(item.price) || 0)} · ${site}`;
  const tgHref = SHARE_TG + '?url=' + encodeURIComponent(url) + '&text=' + encodeURIComponent(text);
  const vkHref = SHARE_VK + '?url=' + encodeURIComponent(url) + '&title=' + encodeURIComponent(text);
  const prevFocus = document.activeElement;
  const box = document.createElement('div');
  box.className = 'cine-sharebox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', 'Поделиться дропом');
  mount(box, html`<div class="csb">
    <button class="cine-ib csb-x" data-x aria-label="Закрыть">${icon('close')}</button>
    <h3>Поделиться дропом</h3>
    <div class="csb-prev" data-prev><span>${icon('image')} Готовим картинку…</span></div>
    <div class="csb-link"><input readonly value="${url}" aria-label="Ссылка на дроп"><button class="cine-btn sm" data-copy>${icon('copy')} <span>Копировать</span></button></div>
    <div class="csb-acts">
      ${navigator.share ? html`<button class="cine-btn gold" data-native>${icon('external')} Отправить…</button>` : ''}
      <a class="cine-btn" target="_blank" rel="noopener noreferrer" href="${tgHref}">Telegram</a>
      <a class="cine-btn" target="_blank" rel="noopener noreferrer" href="${vkHref}">ВКонтакте</a>
      <button class="cine-btn" data-dl disabled>${icon('download')} Картинка</button>
    </div>
    <p class="csb-note">По ссылке друзья увидят карточку дропа и смогут пересмотреть сцену. Баланс и почта не показываются.</p>
  </div>`);
  document.body.append(box);
  let blobUrl = '', file = null;
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); } };
  const close = () => {
    box.remove(); document.removeEventListener('keydown', onKey, true);
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    try { if (prevFocus && document.contains(prevFocus)) prevFocus.focus({ preventScroll: true }); } catch { /* ignore */ }
  };
  document.addEventListener('keydown', onKey, true);
  box.addEventListener('click', async (e) => {
    if (e.target === box || e.target.closest('[data-x]')) { close(); return; }
    const b = e.target.closest('button'); if (!b) return;
    if (b.matches('[data-copy]')) {
      const lbl = b.querySelector('span');
      const ok = () => { if (lbl) { lbl.textContent = 'Скопировано'; setTimeout(() => { lbl.textContent = 'Копировать'; }, 1600); } };
      try { await navigator.clipboard.writeText(url); ok(); }
      catch { const inp = box.querySelector('input'); inp.select(); try { document.execCommand('copy'); ok(); } catch { /* ignore */ } }
    } else if (b.matches('[data-native]')) {
      const d = { title: `${label} — ${site}`, text, url };
      try { if (file && navigator.canShare?.({ files: [file] })) d.files = [file]; await navigator.share(d); } catch { /* отменено */ }
    } else if (b.matches('[data-dl]') && blobUrl) {
      const a = document.createElement('a'); a.href = blobUrl; a.download = `burger-skin-drop-${share}.png`; document.body.append(a); a.click(); a.remove();
    }
  });
  box.querySelector('[data-x]')?.focus({ preventScroll: true });
  const blob = await shareImage(item, fx).catch(() => null);
  if (!box.isConnected) return;
  const prev = box.querySelector('[data-prev]');
  if (blob) {
    blobUrl = URL.createObjectURL(blob);
    try { file = new File([blob], `burger-skin-drop-${share}.png`, { type: 'image/png' }); } catch { file = null; }
    const im = new Image(); im.alt = 'Превью дропа'; im.src = blobUrl; prev.replaceChildren(im);
    const dl = box.querySelector('[data-dl]'); if (dl) dl.disabled = false;
  } else prev.textContent = 'Картинка недоступна — можно поделиться ссылкой.';
}
