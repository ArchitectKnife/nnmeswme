// BURGER SKIN — админ-панель: кинодропы (уровни STANDARD → GODLIKE, пороги, сцены ножей/перчаток, ссылки «Поделиться», предпросмотр).
// Пороги влияют ТОЛЬКО на то, какую сцену показать для уже выданного предмета. Шансы кейсов они не меняют.
import { page, api, html, raw, mount, $, on, toast, busy, loader, notice, num, rub, img } from '../core.js';
import { icon } from '../icons.js';
import { shell, wire } from './admin-ui.js';
import { MODES, LEVELS, LEVEL_META, loadCine, fxBadge } from '../cine-mode.js';

const P = (t) => ({ staff: true, title: t + ' — админ-панель' });
const pctv = (x) => (!(x > 0) ? '0%' : x < 0.0001 ? '<0,01%' : (x * 100).toFixed(x < 0.01 ? 3 : 2).replace('.', ',') + '%');
const DESC = {
  standard: 'Чистая подача: ядро света, одна энерговолна, аккуратное появление предмета без портала.',
  rare: 'Синий портал, объёмные лучи, две энерговолны, искры, лёгкая тряска камеры.',
  epic: 'Фиолетовый разлом с энергонитями, всплеск энергии, осколки, вспышка и ударная волна.',
  legendary: 'Огненный разлом с молниями, долли-зум на вдохе, «брэм», колонны света на финале.',
  godlike: 'Провал в тишину, разлом реальности, золотая сверхновая в slow motion, хор и колокола.',
  knife: 'Холодная сталь: световые клинки через кадр, вращение ножа с торможением, звон клинка.',
  glove: 'Изумруд и янтарь: световые ленты, мягкий подъём перчаток с покачиванием, кожаный щелчок.',
};
const PREVIEW_MODES = [['full', 'Полная сцена'], ['short', 'Короткая'], ['lite', 'Облегчённые эффекты']];
const levelOf = (price, s) => {
  const L = s.levels || {};
  return price >= L.godlike ? 'godlike' : price >= L.legendary ? 'legendary' : price >= L.epic ? 'epic' : price >= L.rare ? 'rare' : 'standard';
};
const floorLevel = (lv, s) => (LEVELS.indexOf(lv) < LEVELS.indexOf(s.special_floor) ? s.special_floor : lv);

page('/admin/drops', async (ctx) => {
  const box = shell(ctx, '/admin/drops', 'Кинодропы', loader());
  wire(box);
  let d = await api('/api/admin/drop-fx');
  let pmode = 'full';
  // Предпросмотр только на настоящих предметах каталога; если нужного уровня нет — берём любой другой пример.
  const sample = (k) => d.samples?.[k] || null;
  const anySample = () => Object.values(d.samples || {}).find(Boolean) || null;
  const previewFor = (k) => {
    const s = d.settings;
    if (k === 'knife' || k === 'glove') { const it = sample(k) || anySample(); return it ? { it, level: floorLevel(levelOf(it.price, s), s), kind: k, own: !!sample(k) } : null; }
    const it = sample(k) || anySample();
    return it ? { it, level: k, kind: null, own: !!sample(k) } : null;
  };
  const rubIn = (name, label, kop) => html`<label class="fld"><span>${label}</span><input name="${name}" type="number" min="1" step="1" value="${Math.round((kop || 0) / 100)}" required></label>`;
  const chk = (name, label, on0) => html`<label class="check"><input type="checkbox" name="${name}" ${on0 ? raw('checked') : ''}><span>${label}</span></label>`;
  const lvSel = (name, label, val, list = LEVELS) => html`<label class="fld"><span>${label}</span><select name="${name}">${list.map((k) => html`<option value="${k}" ${val === k ? raw('selected') : ''}>${LEVEL_META[k].name} — ${LEVEL_META[k].ru}</option>`)}</select></label>`;
  const draw = () => {
    if (!ctx.alive()) return;
    const s = d.settings; const L = s.levels || {}; const cat = d.catalog || {};
    const ranges = { standard: `до ${rub(L.rare)}`, rare: `${rub(L.rare)} – ${rub(L.epic)}`, epic: `${rub(L.epic)} – ${rub(L.legendary)}`, legendary: `${rub(L.legendary)} – ${rub(L.godlike)}`, godlike: `от ${rub(L.godlike)}` };
    const band = (k) => html`<div class="card"><div class="row between gap">${fxBadge({ level: k, label: LEVEL_META[k].name }, icon)}<span class="xs dim">${ranges[k]}</span></div><b class="lg">${num(cat[k]?.items || 0)}</b> <span class="muted sm">скинов · ${num(cat[k]?.n || 0)} цен</span>${LEVELS.indexOf(k) < LEVELS.indexOf(s.trigger) ? html`<div class="xs dim">Без сцены (ниже уровня запуска)</div>` : ''}</div>`;
    const cases = (d.cases || []).slice(0, 80);
    const keys = [...LEVELS, 'knife', 'glove'];
    mount(box, html`
      ${notice('Уровень дропа считает сервер по уже выданному предмету и его цене и сохраняет в ставке. Пороги меняют только то, какая сцена покажется, — шансы кейсов, Provably Fair и выдача предметов остаются прежними.')}
      <form class="card pad adm-form mt" data-f>
        <div class="stack">
          ${chk('enabled', 'Кинодропы включены', s.enabled !== false)}
          ${chk('knife_scene', 'Своя подача для ножей (KNIFE): стальной свет, световые клинки, вращение', s.knife_scene !== false)}
          ${chk('glove_scene', 'Своя подача для перчаток (GLOVES): изумрудный свет, мягкий подъём', s.glove_scene !== false)}
          ${chk('share', 'Кнопка «Поделиться дропом» и публичные страницы /drop/…', s.share !== false)}
          ${chk('reduced_default', 'Облегчённые эффекты по умолчанию (для слабых устройств; игрок может переключить в сцене)', !!s.reduced_default)}
        </div>
        <h3 class="mt">Уровни и пороги стоимости, ₽</h3>
        <div class="grid g4">${rubIn('lv_rare', 'RARE — от', L.rare)}${rubIn('lv_epic', 'EPIC — от', L.epic)}${rubIn('lv_legendary', 'LEGENDARY — от', L.legendary)}${rubIn('lv_godlike', 'GODLIKE — от', L.godlike)}</div>
        <p class="muted sm">Ниже порога RARE — уровень STANDARD. Пороги должны возрастать.</p>
        <div class="grid g4 mt">
          ${lvSel('trigger', 'Сцена запускается с уровня', s.trigger)}
          ${lvSel('special_floor', 'Ножи и перчатки — не ниже уровня', s.special_floor)}
          <label class="fld"><span>Не дешевле N × цены кейса (0 — без условия)</span><input name="min_x" type="number" min="0" step="0.1" value="${s.min_x ?? 0}" required></label>
          <label class="fld"><span>Режим по умолчанию для новых игроков</span><select name="default_mode">${MODES.map(([k, l]) => html`<option value="${k}" ${s.default_mode === k ? raw('selected') : ''}>${l}</option>`)}</select></label>
        </div>
        <p class="muted sm">Игрок всегда может переключить режим на странице кейса («Полные», «Короткие», «Выкл»), пропустить сцену кнопкой «Пропустить», Esc или пробелом, выключить звук и включить облегчённые эффекты прямо в сцене. Системная настройка «уменьшить движение» соблюдается автоматически. Громкость сцен — в разделе «Звук».</p>
        <div class="row gap mt"><button class="btn" data-save>${icon('save')}<span>Сохранить</span></button></div>
      </form>
      <section class="card pad mt">
        <div class="row between gap wrap"><h3 class="mb0">Предпросмотр сцен</h3>
          <label class="fld" style="min-width:220px"><span>Режим предпросмотра</span><select data-pmode>${PREVIEW_MODES.map(([k, l]) => html`<option value="${k}" ${pmode === k ? raw('selected') : ''}>${l}</option>`)}</select></label></div>
        <p class="muted sm">Ничего не выдаёт и не записывает: только показ сцены на примере настоящего предмета из каталога.</p>
        <div class="grid g4">${keys.map((k) => {
          const pv = previewFor(k);
          const badge = fxBadge({ level: pv?.level || (LEVELS.includes(k) ? k : 'epic'), kind: k === 'knife' || k === 'glove' ? k : null }, icon);
          return html`<div class="card"><div class="row between gap">${badge}${pv ? html`<b class="sm">${rub(pv.it.price)}</b>` : ''}</div>
            <div class="item-img" style="max-height:120px">${pv ? img(pv.it.image, '', pv.it.name) : html`<span class="muted sm">Нет предметов в каталоге</span>`}</div>
            <p class="muted xs">${DESC[k]}${pv ? html`<br>${pv.it.name}${pv.own ? '' : ' (пример другого уровня)'}` : ''}</p>
            <button type="button" class="btn ghost sm block" data-prev="${k}" ${pv ? '' : raw('disabled')}>${icon('play')}<span>Показать</span></button></div>`;
        })}</div></section>
      <section class="card pad mt"><h3>Сколько цен каталога попадает в уровни</h3>
        <div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(190px,1fr))">${LEVELS.map((k) => band(k))}</div></section>
      <section class="card pad mt"><h3>Шанс сцены за одно открытие</h3><p class="muted sm">Расчёт по текущим шансам и ценам качеств (без StatTrak™), с учётом уровня запуска и подачи ножей/перчаток. Помогает подобрать пороги, чтобы сцены оставались редкими.</p>
        ${cases.length ? html`<div class="tbl-wrap"><table class="tbl"><thead><tr><th>Кейс</th><th class="r">Цена</th><th class="r">RARE+</th><th class="r">EPIC+</th><th class="r">LEGENDARY+</th><th class="r">GODLIKE</th><th class="r">Любая сцена</th></tr></thead><tbody>${cases.map((c) => html`<tr><td><a href="/cases/${c.slug}">${c.name}</a></td><td class="r">${rub(c.price)}</td><td class="r">${pctv(c.rare)}</td><td class="r">${pctv(c.epic)}</td><td class="r">${pctv(c.legendary)}</td><td class="r">${pctv(c.godlike)}</td><td class="r"><b>${pctv(c.scene)}</b></td></tr>`)}</tbody></table></div>` : html`<p class="muted">Нет опубликованных кейсов</p>`}
      </section>`);
  };
  draw();
  on(box, 'submit', '[data-f]', (e, f) => {
    e.preventDefault();
    const b = $('[data-save]', f);
    busy(b, async () => {
      const kop = (n) => Math.round(Number(f[n].value) * 100);
      const levels = { rare: kop('lv_rare'), epic: kop('lv_epic'), legendary: kop('lv_legendary'), godlike: kop('lv_godlike') };
      if (!(levels.rare > 0 && levels.rare < levels.epic && levels.epic < levels.legendary && levels.legendary < levels.godlike)) { toast('Пороги должны возрастать: RARE < EPIC < LEGENDARY < GODLIKE', 'err'); return; }
      const minX = Number(f.min_x.value);
      if (!(minX >= 0)) { toast('Множитель цены кейса не может быть отрицательным', 'err'); return; }
      const v = { ...d.settings, enabled: f.enabled.checked, knife_scene: f.knife_scene.checked, glove_scene: f.glove_scene.checked, share: f.share.checked, reduced_default: f.reduced_default.checked,
        trigger: f.trigger.value, special_floor: f.special_floor.value, min_x: minX, default_mode: f.default_mode.value, levels };
      await api('/api/admin/settings', { key: 'drop_fx', value: v });
      toast('Настройки кинодропов сохранены', 'ok');
      d = await api('/api/admin/drop-fx');
      draw();
    });
  });
  on(box, 'change', '[data-pmode]', (e, sel) => { pmode = sel.value; });
  on(box, 'click', '[data-prev]', (e, b) => {
    const pv = previewFor(b.dataset.prev);
    if (!pv) return;
    busy(b, async () => {
      const m = await loadCine();
      m.previewDrop(pv.level, pv.it, pv.kind, { mode: pmode === 'short' ? 'short' : 'full', lite: pmode === 'lite' ? true : undefined });
    });
  });
}, P('Кинодропы'));
