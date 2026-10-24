import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scheduleMapLegend, MAP_LEGEND_DURATION_MS } from '../game/mapLegendTimer.js';

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
assert.match(screen, /scheduleMapLegend\(setLegendVisible\)[\s\S]*?\}, \[snap\.mapMode\]\)/,
  'the timer is restarted on every map mode change and cleaned up by its effect');
assert.doesNotMatch(legend, /totalPopulation|nonBelievers|Атеисты|Всего:/,
  'the compact legend must not display population or atheist totals');

console.log('Temporary map legend timing checks passed.');
