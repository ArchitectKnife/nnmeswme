// Оформление обложек кейсов: фон (тема) + цвет кейса + 1–3 настоящих предмета из состава кейса.
// Темы — абстрактные фоны (без изображений оружия); сами фоны рисуются в public/app.css (.cover-bg.t-<тема>).
export const COVER_THEMES: Record<string, string> = {
  burst: 'Вспышка', rays: 'Лучи', hex: 'Соты', grid: 'Сетка', rings: 'Кольца', carbon: 'Карбон', waves: 'Волны',
  circuit: 'Схема', prism: 'Призма', topo: 'Рельеф', stripes: 'Полосы', dots: 'Точки', shards: 'Осколки',
};
export const isCoverTheme = (t: any) => typeof t === 'string' && Object.prototype.hasOwnProperty.call(COVER_THEMES, t);
export const isAccent = (c: any) => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
