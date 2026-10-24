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
  for (const layer of ['land', 'rivers', 'humidity', 'temperature', 'drainage']) {
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
  // The sliced generators must retain deterministic geography exactly.
  for (const mapKind of MAPS) {
    const seed = mapKind === 'random' ? RANDOM_MAP_SEED : undefined;
    const sync = World.create(mapKind, seed);
    const cooperative = await World.createCooperative(mapKind, seed);
    assertWorldParity(sync, cooperative, mapKind);
  }

  // Each map/role path reaches the game with its selected role and first playable card.
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

  // Invalid startup input is rejected; it does not leave the session in a loading state.
  await assert.rejects(
    Game.createCooperative('unknown', 'all'),
    /Неизвестный тип карты/,
  );
  assert.equal(currentGame(), null, 'a failed generation does not install a partial session');

  // Session startup still persists and reloads the generated game state.
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
