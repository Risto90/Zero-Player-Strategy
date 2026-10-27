import { strict as assert } from 'node:assert';
import {
  cityIconIndex,
  cityVisibilityMultiplier,
  cityVisibilityMultiplierForCity,
  cityVisibilityRank,
  isCityVisibleAtZoom,
} from '../components/map/cityIconMath.ts';

for (let rank = 1; rank <= 6; rank += 1) {
  const city = { rank, capital: false };
  const port = { rank, capital: false };
  const capital = { rank, capital: true };
  assert.equal(cityIconIndex(city, false), rank - 1, `rank ${rank} uses the ordinary-city icon`);
  assert.equal(cityIconIndex(port, true), rank + 5, `rank ${rank} uses the matching port icon`);
  assert.equal(cityIconIndex(capital, false), rank - 1, `rank ${rank} capital uses its ordinary-city icon`);
  assert.equal(cityVisibilityRank(city, false), rank, `rank ${rank} ordinary visibility rank`);
  assert.equal(cityVisibilityRank(port, true), Math.min(6, rank + 1), `rank ${rank} port visibility rank`);
  assert.equal(cityVisibilityRank(capital, false), Math.min(6, rank + 2), `rank ${rank} capital visibility rank`);
  assert.equal(cityIconIndex(capital, true), rank + 5, `rank ${rank} capital port uses its matching port icon`);
  assert.equal(cityVisibilityRank({ ...capital, capital: true }, true), Math.min(6, rank + 2),
    `rank ${rank} capital port keeps the two-rank capital threshold`);

  for (const [kind, sample, hasPort] of [
    ['city', city, false],
    ['port', port, true],
    ['capital', capital, false],
  ]) {
    const threshold = cityVisibilityMultiplierForCity(sample, hasPort);
    assert.equal(threshold, cityVisibilityMultiplier(cityVisibilityRank(sample, hasPort)), `${kind} rank ${rank} uses the shared threshold`);
    assert.equal(isCityVisibleAtZoom(threshold - 0.001, 1, cityVisibilityRank(sample, hasPort)), false, `${kind} rank ${rank} stays hidden just below threshold`);
    assert.equal(isCityVisibleAtZoom(threshold, 1, cityVisibilityRank(sample, hasPort)), true, `${kind} rank ${rank} appears at its threshold`);
  }
}

const normalThresholds = Array.from({ length: 6 }, (_, index) => cityVisibilityMultiplier(index + 1));
assert.deepEqual(normalThresholds, [2, 1.8, 1.6, 1.4, 1.2, 1], 'ordinary ranks appear from highest required zoom down to base zoom');
assert.equal(cityVisibilityMultiplierForCity({ rank: 1, capital: false }, true), 1.8, 'rank-1 port appears at 1.8×');
assert.equal(cityVisibilityMultiplierForCity({ rank: 1, capital: true }, false), 1.6, 'rank-1 capital appears at 1.6×');
console.log('City icon mapping and zoom thresholds passed for all six ranks, both icon families, and capital priority.');
