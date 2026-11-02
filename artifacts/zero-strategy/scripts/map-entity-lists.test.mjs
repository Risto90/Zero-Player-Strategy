import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { MapRenderer, hexToRgb } from '../game/render.ts';
import { cityInfluenceRadius } from '../game/settlements.ts';
import { World } from '../game/world.ts';
import { ATHEIST_FLAG_SVG } from '../game/atheistFlag.ts';
import { hasMapObjectList } from '../game/mapModeCapabilities.ts';
import { clearProfileHistory, hasVisitedProfilePath, rememberProfilePath } from '../game/profileRouteHistory.ts';
import { circleHatchLines } from '../components/map/cityInfluenceHatching.ts';
import {
  cityProfileRoute,
  countryProfileRoute,
  cultureProfileRoute,
  raceProfileRoute,
  religionProfileRoute,
} from '../game/profileRoutes.ts';

const root = resolve(process.cwd());
const legendPanel = readFileSync(resolve(root, 'components/game/LegendPanel.tsx'), 'utf8');
const modes = readFileSync(resolve(root, 'components/game/ModeTabs.tsx'), 'utf8');
const rendererSource = readFileSync(resolve(root, 'game/render.ts'), 'utf8');
const webMap = readFileSync(resolve(root, 'components/map/MapView.web.tsx'), 'utf8');
const profileMarks = readFileSync(resolve(root, 'components/profiles/EntityMarks.tsx'), 'utf8');
const emblemPreview = readFileSync(resolve(root, 'components/profiles/EmblemPreview.tsx'), 'utf8');
const atheistFlagFile = readFileSync(resolve(root, 'assets/images/atheist-flag.svg'), 'utf8');

assert.match(legendPanel, /function EntityRow/u);
assert.match(legendPanel, /function EntityRows/u);
assert.match(legendPanel, /styles\.rowBar[\s\S]*row\.percent[\s\S]*backgroundColor: row\.color/u,
  'общая строка сохраняет исходную пропорциональную полосу цвета сущности');
assert.doesNotMatch(legendPanel, /ShareDiagram|react-native-svg/u,
  'доли по-прежнему показываются исходной горизонтальной полосой, а не другой диаграммой');
for (const name of ['countryProfileRoute', 'cultureProfileRoute', 'religionProfileRoute', 'raceProfileRoute', 'cityProfileRoute']) {
  assert.match(legendPanel, new RegExp(name));
}
assert.match(legendPanel, /showShare=\{false\} showSwatch=\{false\}/u,
  'строки городов не показывают долю населения и цветовой квадрат');
assert.match(legendPanel, /profileRouteForId=\{cityProfileRoute\}/u,
  'значок города в списке ведёт в его карточку');
assert.match(legendPanel, /trailingMarkForId=\{\(id\) => \{[\s\S]*<CityIconLink city=\{city\} hasPort=\{hasPort\} size=\{32\}/u,
  'значок города размером 32 пикселя заменяет отдельную кнопку перехода');
assert.match(legendPanel, /<EntityCrownLink[\s\S]*country\.emblemSpec/u,
  'в строке столицы корона и флаг страны находятся перед названием');
assert.match(legendPanel, /afterNameMarkForId=\{\(id\) => \{[\s\S]*<EntityFlagLink spec=\{city\.emblemSpec\} href=\{cityProfileRoute/u,
  'собственный герб города показывается после названия и ведёт в карточку города');
assert.match(legendPanel, /<EntityFlagLink spec=\{country\.emblemSpec\} href=\{countryProfileRoute\(id\)/u,
  'в строках карты показываются ссылки на флаги стран вместо цветовых квадратов');
assert.match(profileMarks, /export function ProfileEntityList/u,
  'карточки используют общий генератор списков стран, религий и городов');
assert.match(profileMarks, /<CityIconLink city=\{item\.city\} hasPort=\{item\.hasPort\}/u,
  'значки городов в списках карточек являются ссылками');
assert.match(profileMarks, /<Text style=\{styles\.cityName\}[^>]*>\{item\.city\.name/u,
  'в общих списках карточек снова отображается название каждого города');
assert.match(profileMarks, /item\.city\.capital && item\.country[\s\S]*<EntityCrownLink/u,
  'в общих списках городов корона показывается у столицы');
assert.match(emblemPreview, /data:image\/svg\+xml/u,
  'флаг на странице сущности остаётся изображением с браузерным контекстным меню');
assert.match(emblemPreview, /createElement\('img'/u,
  'большой флаг карточки является обычным изображением браузера');
assert.match(emblemPreview, /onError:[\s\S]*setFailedImageUri/u,
  'если браузер не показывает встроенное изображение, остаётся видимый SVG');
assert.doesNotMatch(emblemPreview, /showSaveFilePicker|createObjectURL|downloadFlag/u,
  'сохранение флага не использует отдельный диалог или загрузчик');
assert.match(webMap, /renderFlagSpec\(city\.emblemSpec\)/u, 'в браузерных подписях карты отображаются сохранённые флаги городов');
assert.match(webMap, /MaterialCommunityIcons\.getRawGlyphMap\(\)\.crown/u,
  'браузерная карта использует тот же значок короны, что и карточки персонажей');
assert.match(webMap, /if \(city\.capital && iconFontsLoaded\) \{[\s\S]*drawGoldCrown\([\s\S]*labelY - flagHeight \/ 2 - crownSize \/ 2/u,
  'у столицы с гербом золотая корона остаётся над гербом');
assert.match(webMap, /else if \(city\.capital && iconFontsLoaded\) \{\s*drawGoldCrown\(ctx, labelLeft \+ markWidth \/ 2, labelY, crownSize\)/u,
  'корона столицы без собственного герба занимает место перед названием');
assert.doesNotMatch(webMap, /labelY - labelFontSize \/ 2 - crownHeight/u,
  'корона не располагается над названием города');
assert.doesNotMatch(webMap, /countryCrownSvg|countryCrownIconSvg/u,
  'процедурная корона больше не используется');
for (const route of [
  'app/country/[id].tsx',
  'app/city/[id].tsx',
  'app/culture/[id].tsx',
  'app/religion/[id].tsx',
]) {
  assert.match(readFileSync(resolve(root, route), 'utf8'), /ProfileEntityList/u,
    `${route}: используется общий генератор списков сущностей`);
}
assert.equal(atheistFlagFile.replace(/\s+/gu, ''), ATHEIST_FLAG_SVG.replace(/\s+/gu, ''),
  'сохранённый файл флага атеистов совпадает с данными отрисовки');
assert.match(ATHEIST_FLAG_SVG, /width="100" height="200"/u,
  'высота постоянного вымпела атеистов вдвое больше ширины');
assert.equal((ATHEIST_FLAG_SVG.match(/<path\b/gu) ?? []).length, 1,
  'у флага атеистов нет эмблем');
assert.match(profileMarks, /<MaterialCommunityIcons name="crown" size=\{size\} color=\{colors\.light\.crownGold\}/u,
  'корона в списках использует золотой квадратный значок');
assert.doesNotMatch(profileMarks, /countryCrownIconSvg/u,
  'в списках не осталось процедурных вариантов короны');

clearProfileHistory();
rememberProfilePath('/person/12');
rememberProfilePath('/country/3');
rememberProfilePath('/city/7');
assert.equal(hasVisitedProfilePath('/country/3'), true, 'к ранее открытой карточке страны можно вернуться');
rememberProfilePath('/country/3/candidates');
assert.equal(hasVisitedProfilePath('/country/3/candidates'), false, 'вложенная страница страны не считается карточкой сущности');
rememberProfilePath('/country/3');
assert.equal(hasVisitedProfilePath('/city/7'), false, 'повторное открытие страны удаляет последующий город из истории');
assert.equal(hasVisitedProfilePath('/person/12'), true, 'страница персонажа остаётся предыдущей карточкой');
rememberProfilePath('/play');
assert.equal(hasVisitedProfilePath('/person/12'), false, 'при возврате к карте устаревшая история карточек очищается');
assert.match(legendPanel, /game\.selectCity\(row\.id\)/u, 'выбор строки города выделяет его на карте');
assert.match(legendPanel, /game\.showCountryOnMap\(row\.id\)/u, 'строки стран выделяют оседлые и кочевые страны');
assert.doesNotMatch(modes, /id: 'nomads'/u, 'в меню карты нет отдельного режима кочевников');
assert.doesNotMatch(rendererSource, /'nomads'\s*:/u, 'отрисовщик карты не содержит отдельного режима кочевников');
assert.equal(
  existsSync(resolve(root, 'components/map/MapView.tsx')),
  false,
  'в браузерном проекте нет отдельной нативной реализации карты',
);
assert.match(webMap, /cityInfluenceRadius\(game\.world, city\)/u, 'браузерная карта показывает рассчитанные сферы городов');
assert.match(webMap, /if \(selected\) \{[\s\S]*circleHatchLines/u, 'на браузерной карте штрихуется только выбранный город');
assert.match(webMap, /ctx\.arc\(centerX, centerY, radius, 0, Math\.PI \* 2\)[\s\S]*ctx\.clip\(\)/u,
  'штриховка на браузерной карте обрезается по рассчитанному кругу');
assert.match(webMap, /centerX \+ radius < 0/u, 'контуры сфер за пределами окна браузера не рисуются');
const hatch = circleHatchLines(30, 40, 50, 8);
assert.ok(hatch.length > 10, 'полный круг получает равномерно расположенные линии штриховки');
for (const line of hatch) {
  assert.ok(Math.abs(Math.hypot(line.x1 - 30, line.y1 - 40) - 50) < 1e-8,
    'каждый отрезок штриховки начинается на границе круга');
  assert.ok(Math.abs(Math.hypot(line.x2 - 30, line.y2 - 40) - 50) < 1e-8,
    'каждый отрезок штриховки заканчивается на границе круга');
}
const hatchMidpoints = hatch.map((line) => ({
  x: (line.x1 + line.x2) / 2,
  y: (line.y1 + line.y2) / 2,
}));
assert.ok(hatchMidpoints.some(({ x, y }) => Math.abs(Math.hypot(x - 30, y - 40)) < 1e-8),
  'штриховка проходит через центр круга');
assert.ok(hatchMidpoints.some(({ x, y }) => Math.abs(Math.hypot(x - 30, y - 40) - 50) < 1e-8),
  'линии штриховки доходят до края круга, а не обрываются раньше');
assert.equal(hasMapObjectList('political'), true);
assert.equal(hasMapObjectList('cities'), true);
assert.equal(hasMapObjectList('cultures'), true);
assert.equal(hasMapObjectList('religions'), true);
assert.equal(hasMapObjectList('origins'), true);
assert.deepEqual(countryProfileRoute(2), { pathname: '/country/[id]', params: { id: '2' } });
assert.deepEqual(cultureProfileRoute(3), { pathname: '/culture/[id]', params: { id: '3' } });
assert.deepEqual(religionProfileRoute(4), { pathname: '/religion/[id]', params: { id: '4' } });
assert.deepEqual(raceProfileRoute('pygmy'), { pathname: '/race/[id]', params: { id: 'pygmy' } });
assert.deepEqual(cityProfileRoute(5), { pathname: '/city/[id]', params: { id: '5' } });

const world = World.create('random', 51612);
const culture = world.newCulture(null, 1000);
const settled = world.newCountry({
  rank: 'Тестовое государство',
  cultureId: culture.id,
  religionId: null,
  density: 50,
  foundedYear: 1000,
  parentId: null,
});
const inside = world.landIndex.find((pixel) => {
  const x = pixel % MAP_WIDTH;
  const y = Math.floor(pixel / MAP_WIDTH);
  if (x < 3 || y < 3 || x >= MAP_WIDTH - 3 || y >= world.land.length / MAP_WIDTH - 3) return false;
  if ((x + y) % 7 >= 3) return false;
  for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) {
    const point = pixel + dy * MAP_WIDTH + dx;
    if (!world.land[point] || world.rivers[point] > 0) return false;
  }
  return true;
});
assert.notEqual(inside, undefined, 'на тестовой карте найден участок суши без берега и рек');
const center = inside;
const patch = [];
for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) patch.push(center + dy * MAP_WIDTH + dx);
for (const pixel of patch) {
  world.setOwner(pixel, settled.id + 1);
  world.density[pixel] = 50;
}
world.recountCountries();
const nomad = world.newCountry({
  rank: 'Кочевье',
  cultureId: culture.id,
  religionId: null,
  density: 0,
  foundedYear: 1000,
  parentId: null,
});
nomad.type = 'nomadic';
nomad.range = patch;
nomad.cells = [{
  pixel: center,
  population: 50,
  cultureMix: world.cultureTable.single(culture.id, 100),
  religionMix: 0,
  humanOriginMix: world.humanOriginTable.single(0, 100),
}];
const city = world.addCity(settled.id, center, 2, true);
const laterCity = world.addCity(settled.id, patch[1], 2);
assert.ok(city);
assert.ok(laterCity);
const game = new Game(world, 'observer');
game.renderer.flush();
const packed = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
};
const blend = (base, overlay, share) => {
  const a = hexToRgb(base);
  const b = hexToRgb(overlay);
  const mixed = a.map((channel, i) => Math.round(channel + (b[i] - channel) * share));
  return ((255 << 24) | (mixed[2] << 16) | (mixed[1] << 8) | mixed[0]) >>> 0;
};
const stripePixel = center;
game.setMapMode('political');
game.renderer.flush();
assert.equal(game.renderer.pixels[stripePixel], blend(settled.color, nomad.color, 0.48),
  'невыбранная кочевая территория штрихуется поверх заливки оседлой страны');
game.showCountryOnMap(nomad.id);
assert.equal(game.getSnapshot().mapMode, 'political', 'выбор кочевой страны включает политический режим');
assert.equal(game.getSnapshot().selectedCountryId, nomad.id);
game.renderer.flush();
assert.equal(game.renderer.pixels[center], packed(nomad.color), 'выбранная кочевая страна отображается сплошным цветом');
game.showCountryOnMap(nomad.id);
assert.equal(game.getSnapshot().selectedCountryId, null, 'повторный выбор страны снимает выделение');
game.showCountryOnMap(settled.id);
assert.equal(game.getSnapshot().selectedCountryId, settled.id);
game.renderer.flush();
assert.equal(game.renderer.pixels[center], packed(settled.color), 'выбранная оседлая страна отображается сплошным цветом');
game.setMapMode('cultures');
assert.equal(game.getSnapshot().selectedCountryId, null, 'смена режима карты снимает выделение страны');

game.showLayer({ kind: 'culture', id: culture.id });
assert.equal(game.getSnapshot().mapMode, 'cultures');
assert.equal(game.getSnapshot().layer?.kind, 'culture');
game.showLayer(null);
assert.equal(game.getSnapshot().layer, null, 'активный слой культуры можно отключить');
game.selectCity(city.id);
assert.equal(game.getSnapshot().mapMode, 'cities');
assert.equal(game.getSnapshot().selectedCityId, city.id);
assert.ok(cityInfluenceRadius(world, city) > 0, 'сфера выбранного города использует рассчитанный радиус');
game.selectCity(city.id);
assert.equal(game.getSnapshot().selectedCityId, null, 'выделение выбранного города можно снять');
game.setMapMode('political');
assert.equal(game.getSnapshot().selectedCityId, null, 'смена режима карты снимает выделение города');
game.selectCity(laterCity.id);
world.removeCity(city.id);
game.setMapMode('cities');
assert.equal(game.getSnapshot().selectedCityId, laterCity.id, 'выделение сохраняется, если удалён город с меньшим ID');
game.selectCity(laterCity.id);
assert.equal(game.getSnapshot().selectedCityId, null, 'выделение снимается после сдвига ID городов');

console.log('Проверены общие строки сущностей, выделение на карте, кочевые территории и сферы городов.');
