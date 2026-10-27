import assert from 'node:assert/strict';
import { Game } from '../game/game.ts';
import { mulberry32 } from '../game/random.ts';
import { World } from '../game/world.ts';
import { currentGame, deleteSavedGame, startNewGameCooperative } from '../game/session.ts';

const MAPS = ['world', 'random'];
const ROLES = ['all', 'country', 'world', 'observer'];
const RANDOM_MAP_SEED = 84021;

async function withSeed(seed, callback) {
  const previousRandom = Math.random;
  Math.random = mulberry32(seed);
  try {
    return await callback();
  } finally {
    Math.random = previousRandom;
  }
}

function sameRaster(left, right, name) {
  assert.deepEqual(
    Buffer.from(left.buffer, left.byteOffset, left.byteLength),
    Buffer.from(right.buffer, right.byteOffset, right.byteLength),
    `${name} must match the synchronous generator exactly`,
  );
}

function assertWorldParity(sync, cooperative, name) {
  for (const layer of ['land', 'rivers', 'elevation', 'humidity', 'temperature', 'drainage']) {
    sameRaster(sync[layer], cooperative[layer], `${name} ${layer}`);
  }
  sameRaster(sync.water.bodyOf, cooperative.water.bodyOf, `${name} water labels`);
  assert.equal(cooperative.water.bodyCount, sync.water.bodyCount, `${name} water body count`);
  sameRaster(sync.landIndex, cooperative.landIndex, `${name} land index`);
  assert.deepEqual(
    cooperative.water.coastsOf.map((coast) => Buffer.from(coast.buffer, coast.byteOffset, coast.byteLength)),
    sync.water.coastsOf.map((coast) => Buffer.from(coast.buffer, coast.byteOffset, coast.byteLength)),
    `${name} coastal land lists`,
  );
  assert.equal(cooperative.riverPixelCount, sync.riverPixelCount, `${name} river pixel count`);
  assert.equal(cooperative.majorRiverPixelCount, sync.majorRiverPixelCount, `${name} major river pixel count`);
}

const previousPersist = Game.persist;
const previousPause = Game.pause;
Game.persist = false;
Game.pause = async () => {};

try {
  // Разрезанные на части генераторы должны точно сохранять детерминированную географию.
  for (const mapKind of MAPS) {
    const seed = mapKind === 'random' ? RANDOM_MAP_SEED : undefined;
    const sync = World.create(mapKind, seed);
    const cooperative = await World.createCooperative(mapKind, seed);
    assertWorldParity(sync, cooperative, mapKind);
    assert.ok(sync.elevation.some((height) => height > 0), `${mapKind} has positive terrain elevation`);
    assert.ok(sync.elevation.some((height) => height < 0), `${mapKind} has negative elevation or bathymetry`);
    if (mapKind === 'random') {
      const connectedPixels = new Set();
      let hasConfluence = false;
      for (const river of sync.riverFeatures) {
        if (river.pixels.some((pixel) => connectedPixels.has(pixel))) hasConfluence = true;
        for (const pixel of river.pixels) connectedPixels.add(pixel);
      }
      assert.ok(hasConfluence, 'random tributaries join an earlier river');

      const river = sync.riverFeatures.find((feature) => feature.pixels.length > 0);
      assert.ok(river, 'the random map has a river feature');
      const discovererId = sync.countries.length;
      sync.countries.push({ id: discovererId, type: 'settled' });
      const riverPixel = river.pixels[0];
      assert.equal(sync.knownRivers[riverPixel], 0, 'undiscovered rivers do not enter the known-river layer');
      sync.owner[riverPixel] = discovererId + 1;
      sync.territoryVersion += 1;
      assert.equal(sync.discoverGeography(), true, 'territorial expansion discovers nearby geography');
      assert.ok(river.discoveredBy.includes(discovererId), 'the discovering country is recorded');
      assert.ok(sync.knownRivers[riverPixel] > 0, 'discovered rivers enter the known-river layer');

      sync.nameGeographyFeature('river', river.id, 'Испытательная');
      const savedGeography = sync.geographySaveState();
      river.name = null;
      river.discoveredBy = [];
      sync.knownRivers.fill(0);
      sync.restoreGeographyState(savedGeography);
      assert.equal(river.name, 'Испытательная', 'geography names survive saving and restoring');
      assert.ok(river.discoveredBy.includes(discovererId), 'discovery records survive saving and restoring');
      assert.ok(sync.knownRivers[riverPixel] > 0, 'the known-river layer is restored');
    }
  }

  // Каждый путь карты и роли запускает игру с выбранной ролью и первой доступной картой.
  for (const mapKind of MAPS) {
    for (const [index, role] of ROLES.entries()) {
      const game = await withSeed(31_000 + index, () =>
        Game.createCooperative(mapKind, role, mapKind === 'random' ? RANDOM_MAP_SEED : undefined),
      );
      const snapshot = game.getSnapshot();
      assert.equal(snapshot.mapKind, mapKind, `${mapKind}/${role}: selected map`);
      assert.equal(snapshot.role, role, `${mapKind}/${role}: selected role`);
      if (role === 'observer') {
        assert.ok(game.world.countries.length > 0, `${mapKind}/${role}: the first automatic card created a country`);
      } else {
        assert.ok(snapshot.card, `${mapKind}/${role}: the initial card is available`);
      }
      assert.ok(game.world.landIndex.length > 0, `${mapKind}/${role}: generated land is available`);
      assert.ok(snapshot.log.some((line) => line.includes('Мир создан.')), `${mapKind}/${role}: initialization completed`);
      game.discard();
    }
  }

  // Некорректные параметры запуска отклоняются и не оставляют сеанс в состоянии загрузки.
  await assert.rejects(
    Game.createCooperative('unknown', 'all'),
    /Неизвестный тип карты/,
  );
  assert.equal(currentGame(), null, 'a failed generation does not install a partial session');

  // Запущенная игра сохраняется и загружает своё состояние после перезапуска.
  Game.persist = true;
  const game = await withSeed(9127, () => startNewGameCooperative('world', 'all'));
  assert.equal(currentGame(), game);
  await game.saveNow();
  const restored = await Game.load();
  assert.ok(restored, 'the generated game can be restored from its save');
  assert.equal(restored.getSnapshot().mapKind, 'world');
  assert.equal(restored.getSnapshot().role, 'all');
  sameRaster(game.world.land, restored.world.land, 'saved land');
  sameRaster(game.world.humidity, restored.world.humidity, 'saved climate');
  restored.discard();
  await deleteSavedGame();

  console.log('Startup regressions passed for both maps, all roles, failure handling, and save/reload.');
} finally {
  Game.persist = previousPersist;
  Game.pause = previousPause;
  await deleteSavedGame();
}
