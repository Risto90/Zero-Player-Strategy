import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scheduleMapLegend, MAP_LEGEND_DURATION_MS } from '../game/mapLegendTimer.js';
import { hasMapObjectList } from '../game/mapModeCapabilities.js';

const root = resolve(process.cwd());
const screen = readFileSync(resolve(root, 'app/play.tsx'), 'utf8');
const legend = readFileSync(resolve(root, 'components/game/MapLegend.tsx'), 'utf8');

function createTimers() {
  let now = 0;
  let nextId = 0;
  const pending = new Map();
  return {
    pending,
    setTimeout(callback, delay) {
      const id = ++nextId;
      pending.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) {
      pending.delete(id);
    },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const due = [...pending.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at;
        pending.delete(due[0]);
        due[1].callback();
      }
      now = target;
    },
  };
}

assert.equal(MAP_LEGEND_DURATION_MS, 5000, 'the legend must stay visible for five seconds');
for (const mode of ['political', 'cities', 'cultures', 'religions', 'origins']) {
  assert.equal(hasMapObjectList(mode), true, `${mode} must expose its object list`);
}
assert.doesNotMatch(screen, /case 'nomads'/, 'nomadic countries use the political list instead of a dedicated mode');
for (const mode of ['biomes', 'humidity', 'temperature', 'drainage', 'density', 'rivers']) {
  assert.equal(hasMapObjectList(mode), false, `${mode} must not expose an object list`);
}

assert.match(screen, /hasMapObjectList\(snap\.mapMode\) && \([\s\S]*?testID="button-open-map-list"/,
  'the list button is shown only for map modes with object lists');
assert.match(screen, /if \(hasMapObjectList\(snap\.mapMode\)\) \{[\s\S]*?setLegendVisible\(false\)/,
  'list modes suppress the temporary legend');
assert.match(screen, /legendVisible && !hasMapObjectList\(snap\.mapMode\)/,
  'temporary legends are shown only for map modes without lists');
assert.match(screen, /setLegendVisible\)[\s\S]*?\}, \[snap\.mapMode\]\)/,
  'the five-second timer is restarted after every mode change');
assert.match(legend, /case 'biomes':\s*return <BiomeTable rows=\{snap\.legend\.biomes\} \/>/,
  'biome colors and labels use the table layout');
assert.match(legend, /biomeSwatch[\s\S]*?biomeLabel/,
  'biome swatches are placed above their corresponding labels');
assert.match(legend, /biomeTable: \{ width: '100%', flexDirection: 'row'/,
  'the biome table fills the available panel width');
assert.match(legend, /biomeCell: \{ flex: 1, minWidth: 0/,
  'biome cells shrink equally instead of overflowing horizontally');
assert.match(legend, /biome-legend-table/,
  'the biome table has a stable test identifier');

const timers = createTimers();
const visibility = [];
const hideFirst = scheduleMapLegend((visible) => visibility.push(visible), timers);
assert.deepEqual(visibility, [true], 'the legend appears when its timer starts');
timers.advance(4999);
assert.deepEqual(visibility, [true], 'the legend remains visible until five seconds');

hideFirst();
const hideSecond = scheduleMapLegend((visible) => visibility.push(visible), timers);
assert.deepEqual(visibility, [true, true], 'a mode change shows the new legend immediately');
assert.equal(timers.pending.size, 1, 'changing modes cancels the previous timeout');
timers.advance(4999);
assert.deepEqual(visibility, [true, true], 'the restarted timer does not hide the new legend early');
timers.advance(1);
assert.deepEqual(visibility, [true, true, false], 'the restarted timer hides the legend at five seconds');
hideSecond();
assert.doesNotMatch(legend, /totalPopulation|nonBelievers|Атеисты|Всего:/,
  'the compact legend must not display population or atheist totals');

console.log('Temporary map legend timing checks passed.');
