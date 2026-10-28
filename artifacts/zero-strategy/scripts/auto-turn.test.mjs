import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Game } from '../game/game.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { AUTO_TURN_HOLD_MS } from '../game/holdConfirmation.ts';
import { World } from '../game/world.ts';

const screen = readFileSync(resolve(process.cwd(), 'app/play.tsx'), 'utf8');
const layout = readFileSync(resolve(process.cwd(), 'app/_layout.tsx'), 'utf8');

function makeFixture(seed) {
  const world = World.create('random', seed);
  const culture = world.newCulture(null, 1000);
  const country = world.newCountry({
    rank: 'тест',
    cultureId: culture.id,
    religionId: null,
    density: 80,
    foundedYear: 1000,
    parentId: null,
    government: 'hereditary',
  });
  const pixels = Array.from(world.landIndex.slice(0, 200));
  const mix = world.cultureTable.single(culture.id, 100);
  for (const pixel of pixels) {
    world.setOwner(pixel, country.id + 1);
    world.density[pixel] = 80;
    world.humidity[pixel] = 45;
    world.temperature[pixel] = 50;
    world.drainage[pixel] = 50;
    world.culture[pixel] = mix;
  }
  world.recountCountries();
  assert.ok(world.addCity(country.id, pixels[0], 1, true));
  return { world, country, pixels };
}

function makeCard(type, updates = {}) {
  return {
    type,
    title: type,
    detail: type,
    ink: 12,
    inkTotal: 12,
    targetCountryId: null,
    newCountryId: null,
    newCultureId: null,
    newReligionId: null,
    sourceCultureId: null,
    newGovernmentId: null,
    newRuler: null,
    choices: null,
    selectedChoice: 0,
    characterEvent: null,
    hint: -1,
    ...updates,
  };
}

const previousPersist = Game.persist;
const previousPause = Game.pause;
Game.persist = false;
Game.pause = async () => {};

try {
  assert.equal(AUTO_TURN_HOLD_MS, 3000, 'подтверждение автохода длится ровно три секунды');

  // Истечение времени автоматически завершает карту независимо от состояния отрисовки.
  {
    const { world, pixels } = makeFixture(61_401);
    const game = new Game(world, 'all');
    game.setPlayScreenActive(true);
    const card = makeCard('rain', { hint: pixels[20] });
    game.startCard(card);
    game.dispatchAction({
      type: 'dab',
      x: (pixels[20] % MAP_WIDTH) + 0.5,
      y: Math.floor(pixels[20] / MAP_WIDTH) + 0.5,
      radius: 1,
    });
    game.dispatchAction({ type: 'endStroke' });
    const manuallyPaintedHumidity = world.humidity[pixels[20]];
    assert.ok(card.ink < card.inkTotal, 'игрок может частично выполнить действие карты');
    const year = game.getSnapshot().year;
    assert.equal(game.getSnapshot().canCompleteCard, false, 'для оставшихся чернил нужно удерживать кнопку автохода');
    await game.nextTurn();
    assert.equal(game.getSnapshot().year, year, 'короткое нажатие не пропускает незавершённую карту');
    assert.ok(game.getSnapshot().card, 'после короткого нажатия незавершённая карта остаётся активной');
    game.secondsLeft = 1;
    game.tick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(game.getSnapshot().year, year + 1, 'таймер автоматически завершает карту и переводит игру на следующий год');
    assert.equal(world.humidity[pixels[20]], manuallyPaintedHumidity,
      'автоматическое завершение использует состояние кисти и не закрашивает действие игрока повторно');
    assert.equal(card.ink, 0, 'автоматическая стратегия расходует остаток чернил на допустимые климатические цели');
    assert.equal(game.getSnapshot().drawing, false, 'завершение расчёта не ждёт отрисовку карты');
    const nextTurnSeconds = game.secondsLeft;
    game.tick();
    assert.equal(game.secondsLeft, nextTurnSeconds - 1, 'таймер продолжает идти независимо от перерисовки карты');
    game.discard();
  }

  // Автоматическая стратегия размещает город только при соблюдении правил карты города.
  {
    const { world, country } = makeFixture(61_402);
    const game = new Game(world, 'all');
    game.setPlayScreenActive(true);
    const card = makeCard('buildCity', { targetCountryId: country.id, ink: 0, inkTotal: 0 });
    const oldCityCount = world.cities.filter((city) => city.countryId === country.id).length;
    game.startCard(card);
    const year = game.getSnapshot().year;
    assert.equal(game.getSnapshot().canCompleteCard, false, 'обязательное основание города не позволяет завершить карту досрочно');
    await game.nextTurn();
    assert.equal(game.getSnapshot().year, year, 'короткое нажатие не обходит обязательное размещение города');
    await game.nextTurn(true);
    assert.equal(card.cityPlaced, true, 'автоматическое завершение основывает обязательный город');
    assert.equal(world.cities.filter((city) => city.countryId === country.id).length, oldCityCount + 1,
      'пустая карта города создаёт ровно один город');
    assert.equal(game.getSnapshot().year, year + 1, 'карта города завершается обычным ходом');
    game.discard();
  }

  // Потраченные чернила и основанный город позволяют завершить карту обычным нажатием.
  {
    const { world, country } = makeFixture(61_404);
    const game = new Game(world, 'all');
    game.setPlayScreenActive(true);
    const card = makeCard('buildCity', {
      targetCountryId: country.id,
      ink: 0,
      inkTotal: 12,
      cityPlaced: true,
    });
    game.startCard(card);
    const year = game.getSnapshot().year;
    assert.equal(game.getSnapshot().canCompleteCard, true, 'карту с основанным городом и потраченными чернилами можно завершить');
    await game.nextTurn();
    assert.equal(game.getSnapshot().year, year + 1, 'короткое нажатие завершает готовую карту и переводит игру на следующий год');
    assert.notEqual(game.getSnapshot().card?.title, card.title, 'завершённая карта больше не активна');
    game.discard();
  }

  // Автоматическое завершение карты без действий сохраняет выбранный игроком вариант.
  {
    const { world } = makeFixture(61_403);
    const game = new Game(world, 'all');
    game.setPlayScreenActive(true);
    const card = makeCard('character', {
      choices: [
        { label: 'Первый вариант', detail: 'Первый вариант.' },
        { label: 'Второй вариант', detail: 'Второй вариант.' },
      ],
    });
    game.startCard(card);
    game.selectChoice(1);
    let automaticChoiceChanges = 0;
    const dispatch = game.dispatchAction.bind(game);
    game.dispatchAction = (action) => {
      if (action.type === 'selectChoice') automaticChoiceChanges += 1;
      return dispatch(action);
    };
    await game.nextTurn(true);
    assert.equal(card.selectedChoice, 1, 'автоход сохраняет выбранный игроком вариант');
    assert.equal(automaticChoiceChanges, 0, 'автоход не заменяет выбор игрока случайным вариантом');
    game.discard();
  }

  // При уходе со страницы приостанавливается только незавершённый ход игрока.
  {
    const { world } = makeFixture(61_405);
    const game = new Game(world, 'all');
    game.setPlayScreenActive(true);
    game.startCard(makeCard('rain'));
    game.secondsLeft = 23;
    game.setPlayScreenActive(false);
    assert.equal(game.getSnapshot().paused, true, 'уход со страницы Play приостанавливает карту игрока');
    assert.equal(game.getSnapshot().offscreenTurnAlert, true, 'оболочка приложения получает признак паузы вне страницы');
    game.tick();
    assert.equal(game.secondsLeft, 23, 'таймер карты игрока не идёт за пределами Play');
    game.setPlayScreenActive(true);
    assert.equal(game.getSnapshot().paused, false, 'возвращение на Play снимает автоматическую паузу');
    assert.equal(game.getSnapshot().offscreenTurnAlert, false, 'возвращение убирает предупреждение о паузе');
    game.tick();
    assert.equal(game.secondsLeft, 22, 'после возвращения таймер карты игрока продолжает отсчёт');

    game.togglePause();
    game.setPlayScreenActive(false);
    game.setPlayScreenActive(true);
    assert.equal(game.getSnapshot().paused, true, 'уход и возвращение не отменяют ручную паузу');
    assert.equal(game.getSnapshot().offscreenTurnAlert, false, 'ручная пауза не включает предупреждение о ходе вне страницы');
    game.discard();
  }

  {
    const { world } = makeFixture(61_406);
    const game = new Game(world, 'observer');
    game.startCard(makeCard('rain'));
    game.secondsLeft = 23;
    game.setPlayScreenActive(false);
    assert.equal(game.getSnapshot().paused, false, 'уход со страницы не приостанавливает наблюдателя');
    assert.equal(game.getSnapshot().offscreenTurnAlert, false, 'в режиме наблюдателя нет предупреждения о ходе игрока');
    game.discard();
  }
} finally {
  Game.persist = previousPersist;
  Game.pause = previousPause;
}

assert.match(screen, /<View style=\{styles\.titleRow\}>[\s\S]*?Zero Strategy[\s\S]*?<View style=\{styles\.topBar\}>/,
  'название игры размещено над верхней панелью');
assert.match(screen, /onLongPress=\{snap\.card && !snap\.canCompleteCard && !snap\.busy \? \(\) => \{[\s\S]*?game\.nextTurn\(true\)/,
  'долгое нажатие запускает автоматическое завершение карты');
assert.match(screen, /delayLongPress=\{AUTO_TURN_HOLD_MS\}/,
  'для автоматического завершения нужно удерживать кнопку все три секунды');
assert.match(screen, /onPressOut=\{\(\) => setHoldingNext\(false\)\}/,
  'при раннем отпускании скрывается подсказка удержания');
assert.match(screen, /if \(!snap\.card \|\| snap\.canCompleteCard\) void game\.nextTurn\(\)/,
  'короткое нажатие завершает только готовую карту');
assert.match(screen, /Удерживайте 3 секунды для автохода/,
  'во время удержания показывается подсказка о трёх секундах');
assert.match(layout, /Stack\.Screen name="play" options=\{\{[^}]*freezeOnBlur: false/u,
  'страница Play остаётся активной в стеке при открытии других страниц');
assert.match(screen, /game\.setPlayScreenActive\(true\)[\s\S]*?game\.setPlayScreenActive\(false\)/u,
  'карта сообщает игре о входе и выходе со страницы Play, не останавливая сессию');
assert.match(screen, /window\.confirm\('Выйти в меню\?/u,
  'выход в меню требует подтверждения');
assert.match(screen, /if \(!exitRequested \|\| snap\.busy \|\| snap\.card\) return;/u,
  'выход ждёт завершения хода и действий игрока');
assert.match(screen, /void leaveGame\(\)/u,
  'перед переходом в меню игра сохраняется и закрывается');

console.log('Проверки хода, таймера, паузы вне Play и подтверждения выхода завершены.');
