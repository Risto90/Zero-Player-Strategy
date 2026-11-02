import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = '/tmp/zero-strategy-algebra-query.mjs';
execFileSync(path.join(appRoot, '../api-server/node_modules/.bin/esbuild'), [
  path.join(appRoot, 'kernel/algebra.ts'), '--bundle', '--platform=node', '--format=esm', `--outfile=${output}`,
]);
const { runAlgebraQuery } = await import(pathToFileURL(output));

function run(inputs, operations) {
  return runAlgebraQuery({ inputs, operations });
}

const table = (columns, rows, weightColumn) => ({ columns, rows, ...(weightColumn ? { weightColumn } : {}) });
const ids = table(['id'], [[1], [2], [2], [4]]);
const rhs = table(['id'], [[2], [3], [3]]);
const setResult = run({
  a: ids, b: rhs, universe: table(['id'], [[1], [2], [3], [4], [5]]), needle: table(['id'], [[2]]),
  subsetLeft: table(['id'], [[1], [2]]),
  equalLeft: table(['id'], [[4], [2], [1]]),
  equalRight: table(['id'], [[1], [2], [4], [4]]),
  disjointLeft: table(['id'], [[1]]),
  disjointRight: table(['id'], [[3]]),
}, [
  { op: 'set', id: 'union', mode: 'set', kind: 'union', left: 'a', right: 'b' },
  { op: 'set', id: 'intersection', mode: 'set', kind: 'intersection', left: 'a', right: 'b' },
  { op: 'set', id: 'difference', mode: 'set', kind: 'difference', left: 'a', right: 'b' },
  { op: 'set', id: 'xor', mode: 'set', kind: 'symmetricDifference', left: 'a', right: 'b' },
  { op: 'set', id: 'complement', mode: 'set', kind: 'complement', left: 'a', universe: 'universe' },
  { op: 'contains', id: 'has2', left: 'a', right: 'needle' },
  { op: 'subset', id: 'isSubset', left: 'subsetLeft', right: 'a' },
  { op: 'equal', id: 'isEqual', left: 'equalLeft', right: 'equalRight' },
  { op: 'disjoint', id: 'isDisjoint', left: 'disjointLeft', right: 'disjointRight' },
  { op: 'set', id: 'multisetUnion', mode: 'multiset', kind: 'union', left: 'a', right: 'b' },
  { op: 'set', id: 'multisetSum', mode: 'multiset', kind: 'intersection', left: 'a', right: 'b' },
]);
assert.deepEqual(setResult.tables.union.rows, [[1], [2], [3], [4]]);
assert.deepEqual(setResult.tables.intersection.rows, [[2]]);
assert.deepEqual(setResult.tables.difference.rows, [[1], [4]]);
assert.deepEqual(setResult.tables.xor.rows, [[1], [3], [4]]);
assert.deepEqual(setResult.tables.complement.rows, [[3], [5]]);
assert.equal(setResult.values.has2, true);
assert.equal(setResult.values.isSubset, true);
assert.equal(setResult.values.isEqual, true);
assert.equal(setResult.values.isDisjoint, true);
assert.deepEqual(setResult.tables.multisetUnion.rows, [[1], [2], [2], [3], [3], [4]]);
assert.deepEqual(setResult.tables.multisetSum.rows, [[2]]);

const popA = table(['culture', 'faith', 'origin', 'country', 'mass'], [
  [1, 7, 30, 2, 0.125], [1, null, 30, 2, 1.75], [1, 7, 31, 2, 5.5], [2, 7, 30, 2, 2],
], 'mass');
const popB = table(['culture', 'faith', 'origin', 'country', 'mass'], [
  [1, 7, 30, 2, 0.5], [1, null, 30, 2, 0.25], [2, 8, 30, 3, 4],
], 'mass');
const universe = table(['culture', 'faith', 'origin', 'country', 'mass'], [
  [1, 7, 30, 2, 1], [1, null, 30, 2, 2], [1, 7, 31, 2, 8],
  [2, 7, 30, 2, 3], [2, 8, 30, 3, 5], [9, null, 99, 4, 7],
], 'mass');
const dimensionKeys = ['culture', 'faith', 'origin', 'country'];
const population = run({ a: popA, b: popB, universe }, [
  { op: 'set', id: 'measureUnion', mode: 'measure', kind: 'union', left: 'a', right: 'b', keyColumns: dimensionKeys },
  { op: 'set', id: 'measureIntersection', mode: 'measure', kind: 'intersection', left: 'a', right: 'b', keyColumns: dimensionKeys },
  { op: 'set', id: 'measureDifference', mode: 'measure', kind: 'difference', left: 'a', right: 'b', keyColumns: dimensionKeys },
  { op: 'set', id: 'measureXor', mode: 'measure', kind: 'symmetricDifference', left: 'a', right: 'b', keyColumns: dimensionKeys },
  { op: 'set', id: 'measureComplement', mode: 'measure', kind: 'complement', left: 'a', universe: 'universe', keyColumns: dimensionKeys },
  { op: 'measureSum', id: 'explicitSum', inputs: ['a', 'b'], keyColumns: dimensionKeys, weightColumn: 'mass' },
]);
const asMap = (result) => new Map(result.rows.map((row) => [JSON.stringify(row.slice(0, 4)), row[4]]));
const key = (culture, faith, origin, owner) => JSON.stringify([culture, faith, origin, owner]);
assert.equal(asMap(population.tables.measureUnion).get(key(1, 7, 30, 2)), 0.5, 'union is max, not an implicit population sum');
assert.equal(asMap(population.tables.measureIntersection).get(key(1, 7, 30, 2)), 0.125);
assert.equal(asMap(population.tables.measureDifference).get(key(1, 7, 30, 2)) ?? 0, 0);
assert.equal(asMap(population.tables.measureDifference).get(key(1, 7, 31, 2)), 5.5);
assert.equal(asMap(population.tables.measureXor).get(key(1, 7, 30, 2)), 0.375);
assert.equal(asMap(population.tables.measureComplement).get(key(9, null, 99, 4)), 7);
assert.equal(asMap(population.tables.explicitSum).get(key(1, 7, 30, 2)), 0.625);
assert.equal(asMap(population.tables.explicitSum).get(key(1, null, 30, 2)), 2);
assert.equal(population.tables.explicitSum.rows.reduce((sum, row) => sum + row[4], 0), 14.125);

const query = run({ people: table(['culture', 'faith', 'home', 'mass'], [
  [2, null, 8, 4], [1, 9, 8, 2], [1, null, 7, 3], [2, 9, 7, 1],
], 'mass') }, [
  { op: 'filter', id: 'filtered', input: 'people', where: { op: 'and', predicates: [
    { op: 'gte', column: 'mass', value: 2 },
    { op: 'or', predicates: [{ op: 'eq', column: 'faith', value: null }, { op: 'eq', column: 'culture', value: 1 }] },
  ] } },
  { op: 'partition', id: 'parts', input: 'people', where: { op: 'isNull', column: 'faith' } },
  { op: 'project', id: 'projected', input: 'filtered', columns: [
    { from: 'culture' }, { from: 'faith' }, { from: 'mass' },
  ] },
  { op: 'group', id: 'grouped', input: 'people', by: ['culture', 'faith'], aggregates: [
    { op: 'count', as: 'records' }, { op: 'sum', column: 'mass', as: 'population' },
    { op: 'mean', column: 'mass', as: 'average' }, { op: 'min', column: 'home', as: 'firstHome' },
    { op: 'max', column: 'home', as: 'lastHome' },
  ] },
  { op: 'filter', id: 'partitionFollowup', input: 'parts:true', where: { op: 'eq', column: 'culture', value: 1 } },
]);
assert.deepEqual(query.tables.filtered.rows, [[2, null, 8, 4], [1, 9, 8, 2], [1, null, 7, 3]]);
assert.equal(query.tables.projected.weightColumn, 'mass');
assert.equal(query.tables['parts:true'].rows.length, 2);
assert.equal(query.tables['parts:false'].rows.length, 2);
assert.equal(query.tables.grouped.rows.length, 4);
assert.deepEqual(query.tables.grouped.columns, ['culture', 'faith', 'records', 'population', 'average', 'firstHome', 'lastHome']);
assert.equal(query.tables.partitionFollowup.rows.length, 1);

const joined = run({
  l: table(['id', 'value'], [[1, 'a'], [1, 'b'], [2, 'c']]),
  r: table(['ref', 'extra'], [[1, 'x'], [1, 'y'], [3, 'z']]),
}, [
  { op: 'join', id: 'joined', left: 'l', right: 'r', on: [{ left: 'id', right: 'ref' }],
    columns: [{ from: 'left', column: 'id', as: 'id' }, { from: 'left', column: 'value', as: 'value' },
      { from: 'right', column: 'extra', as: 'extra' }] },
  { op: 'product', id: 'product', left: 'l', right: 'r' },
]);
assert.deepEqual(joined.tables.joined.rows, [
  [1, 'a', 'x'], [1, 'a', 'y'], [1, 'b', 'x'], [1, 'b', 'y'],
]);
assert.equal(joined.tables.product.rows.length, 9);

const source = table(['culture', 'faith', 'origin', 'home', 'mass'], [
  [1, 7, 10, 2, 4], [1, null, 10, 2, 3], [2, 7, 10, 2, 5], [3, 8, 11, 3, 8],
], 'mass');
const reference = table(['culture', 'faith', 'origin', 'home', 'mass'], [
  [1, 7, 10, 2, 2], [1, null, 10, 2, 1],
], 'mass');
const taken = run({ source, reference, destination: table(source.columns, [[3, 8, 11, 3, 1]], 'mass') }, [
  { op: 'take', id: 'slice', input: 'source', reference: 'reference', keyColumns: ['culture', 'faith', 'origin', 'home'],
    weightColumn: 'mass', amount: 6, priorities: [
      { columns: ['culture', 'faith'], rank: 0 }, { columns: ['culture'], rank: 1 },
    ] },
  { op: 'transfer', id: 'move', input: 'source', destination: 'destination', reference: 'reference',
    keyColumns: ['culture', 'faith', 'origin', 'home'], weightColumn: 'mass', amount: 4,
    priorities: [{ columns: ['culture', 'faith'], rank: 0 }] },
  { op: 'remove', id: 'delete', input: 'source', keyColumns: ['culture', 'faith', 'origin', 'home'],
    weightColumn: 'mass', amount: 1 },
  { op: 'measureSum', id: 'splitRecombined', inputs: ['slice:selected', 'slice:remaining'],
    keyColumns: ['culture', 'faith', 'origin', 'home'], weightColumn: 'mass' },
  { op: 'choose', id: 'choice', input: 'source', reference: 'reference',
    keyColumns: ['culture', 'faith', 'origin', 'home'], weightColumn: 'mass', seed: 0x12345678,
    priorities: [{ columns: ['culture', 'faith'], rank: 0 }] },
]);
const total = (rows) => rows.reduce((sum, row) => sum + row[4], 0);
assert.equal(total(taken.selections.slice.selected.rows), 6);
assert.equal(total(taken.selections.slice.remaining.rows), 14);
assert.equal(total(taken.selections.move.selected.rows) + total(taken.selections.move.remaining.rows), 20);
assert.equal(total(taken.selections.move.destination.rows), 5);
assert.equal(total(taken.selections.delete.remaining.rows), 19);
assert.equal(total(taken.selections.delete.selected.rows), 1);
assert.equal(total(taken.tables.splitRecombined.rows), 20);
assert.equal(taken.tables.choice.rows.length, 1);
assert.deepEqual(taken.tables.choice.rows, run({ source, reference }, [
  { op: 'choose', id: 'choice', input: 'source', reference: 'reference',
    keyColumns: ['culture', 'faith', 'origin', 'home'], weightColumn: 'mass', seed: 0x12345678,
    priorities: [{ columns: ['culture', 'faith'], rank: 0 }] },
]).tables.choice.rows);

// Независимый простой эталон для операций над конечными множествами.
function referenceSet(left, right, universe) {
  const a = new Set(left), b = new Set(right);
  return {
    union: [...new Set([...a, ...b])].sort((x, y) => x - y),
    intersection: [...a].filter((value) => b.has(value)).sort((x, y) => x - y),
    difference: [...a].filter((value) => !b.has(value)).sort((x, y) => x - y),
    symmetricDifference: [...new Set([...a, ...b])].filter((value) => a.has(value) !== b.has(value)).sort((x, y) => x - y),
    complement: universe.filter((value) => !a.has(value)),
  };
}
let randomState = 0x6a09e667;
function random() { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 0x1_0000_0000; }
for (let trial = 0; trial < 500; trial += 1) {
  const left = Array.from({ length: 35 }, (_, i) => i).filter(() => random() < 0.4);
  const right = Array.from({ length: 35 }, (_, i) => i).filter(() => random() < 0.4);
  const all = Array.from({ length: 35 }, (_, i) => i);
  const expected = referenceSet(left, right, all);
  const result = run({ a: table(['v'], left.map((v) => [v])), b: table(['v'], right.map((v) => [v])),
    universe: table(['v'], all.map((v) => [v])) }, [
    ...['union', 'intersection', 'difference', 'symmetricDifference'].map((kind) =>
      ({ op: 'set', id: kind, mode: 'set', kind, left: 'a', right: 'b' })),
    { op: 'set', id: 'complement', mode: 'set', kind: 'complement', left: 'a', universe: 'universe' },
  ]);
  for (const kind of Object.keys(expected)) assert.deepEqual(result.tables[kind].rows.map(([v]) => v), expected[kind]);
  assert.equal(result.values?.subset, undefined);
  const counts = new Set(left).size + new Set(right).size - expected.intersection.length;
  assert.equal(expected.union.length, counts, 'включение–исключение');
}

for (let trial = 0; trial < 150; trial += 1) {
  const rows = Array.from({ length: 20 }, (_, index) => [
    index % 3, index % 5 === 0 ? null : index % 4, index % 7, index % 2, random() * 100 + 0.00001,
  ]);
  const input = table(['culture', 'faith', 'origin', 'owner', 'mass'], rows, 'mass');
  const result = run({ input }, [{
    op: 'take', id: 'split', input: 'input', keyColumns: ['culture', 'faith', 'origin', 'owner'],
    weightColumn: 'mass', amount: random() * total(rows),
  }]);
  const beforeByGroup = new Map();
  for (const row of rows) {
    const key = JSON.stringify(row.slice(0, 4));
    beforeByGroup.set(key, (beforeByGroup.get(key) ?? 0) + row[4]);
  }
  const afterByGroup = new Map();
  for (const row of [...result.selections.split.selected.rows, ...result.selections.split.remaining.rows]) {
    const key = JSON.stringify(row.slice(0, 4));
    afterByGroup.set(key, (afterByGroup.get(key) ?? 0) + row[4]);
  }
  assert.equal(afterByGroup.size, beforeByGroup.size);
  for (const [key, mass] of beforeByGroup) assert.ok(Math.abs(afterByGroup.get(key) - mass) < 1e-10);
  assert.ok(Math.abs(total(result.selections.split.selected.rows) + total(result.selections.split.remaining.rows) - total(rows)) < 1e-9);
}

for (let trial = 0; trial < 100; trial += 1) {
  const makeGroups = () => Array.from({ length: 24 }, (_, index) => [
    index % 4, index % 6 === 0 ? null : index % 5, index % 7, index % 3, random() * 20,
  ]);
  const left = makeGroups(), right = makeGroups();
  const toMap = (rows) => {
    const result = new Map();
    for (const row of rows) {
      const key = JSON.stringify(row.slice(0, 4));
      result.set(key, (result.get(key) ?? 0) + row[4]);
    }
    return result;
  };
  const a = toMap(left), b = toMap(right);
  const allKeys = [...new Set([...a.keys(), ...b.keys()])];
  const expected = {
    union: (x, y) => Math.max(x, y),
    intersection: (x, y) => Math.min(x, y),
    difference: (x, y) => Math.max(0, x - y),
    symmetricDifference: (x, y) => Math.abs(x - y),
  };
  for (const [kind, operation] of Object.entries(expected)) {
    const actual = run({
      a: table(['culture', 'faith', 'origin', 'owner', 'mass'], left, 'mass'),
      b: table(['culture', 'faith', 'origin', 'owner', 'mass'], right, 'mass'),
    }, [{ op: 'set', id: 'result', mode: 'measure', kind, left: 'a', right: 'b',
      keyColumns: ['culture', 'faith', 'origin', 'owner'] }]).tables.result;
    const actualMap = toMap(actual.rows);
    for (const key of allKeys) {
      const expectedMass = operation(a.get(key) ?? 0, b.get(key) ?? 0);
      assert.ok(Math.abs((actualMap.get(key) ?? 0) - expectedMass) < 1e-10);
    }
  }
}

assert.deepEqual(run({ empty: table(['id'], []) }, [
  { op: 'filter', id: 'none', input: 'empty', where: { op: 'eq', column: 'id', value: 1 } },
]).tables.none.rows, []);
const large = run({ a: table(['id', 'mass'], [[1, 1e200]], 'mass'), b: table(['id', 'mass'], [[1, 1e200]], 'mass') }, [
  { op: 'measureSum', id: 'large', inputs: ['a', 'b'], keyColumns: ['id'], weightColumn: 'mass' },
]);
assert.equal(large.tables.large.rows[0][1], 2e200);
const largeMean = run({ values: table(['group', 'value'], [[1, 1e308], [1, 1e308]]) }, [
  { op: 'group', id: 'means', input: 'values', by: ['group'],
    aggregates: [{ op: 'mean', column: 'value', as: 'mean' }] },
]);
assert.equal(largeMean.tables.means.rows[0][1], 1e308);
assert.throws(() => run({ bad: table(['id'], [[NaN]]) }, []), /Недопустимое значение/);
assert.throws(() => run({ bad: table(['id', 'mass'], [[1, -1]], 'mass') }, []), /неотрицательным числом/);
assert.throws(() => run({ bad: table(['id'], [[1, 2]]) }, []), /неверную ширину/);
assert.throws(() => run({ a: ids }, [{ op: 'filter', id: 'bad', input: 'a', where: { op: 'eq', column: 'missing', value: 1 } }]), /Неизвестный столбец/);
assert.throws(() => run({ a: ids }, [{ op: 'set', id: 'bad', mode: 'set', kind: 'complement', left: 'a' }]), /Неизвестная таблица/);
assert.throws(() => run({ a: popA, b: popB }, [{
  op: 'set', id: 'badProjection', mode: 'measure', kind: 'union', left: 'a', right: 'b',
  keyColumns: ['culture', 'faith'],
}]), /сохраняют все совместные измерения/);
assert.throws(() => run({ a: table(['id', 'mass'], [[1, Number.MAX_VALUE]], 'mass'),
  b: table(['id', 'mass'], [[1, Number.MAX_VALUE]], 'mass') }, [
  { op: 'measureSum', id: 'overflow', inputs: ['a', 'b'], keyColumns: ['id'], weightColumn: 'mass' },
]), /Переполнение суммы меры/);

// Полная производительность одного JS-вызова, включая создание и проверку запроса.
const perfRows = Array.from({ length: 25_000 }, (_, index) => [index % 500, index % 17, index + 0.25]);
const start = performance.now();
const perf = run({ rows: table(['culture', 'faith', 'mass'], perfRows, 'mass') }, [
  { op: 'filter', id: 'faithful', input: 'rows', where: { op: 'notNull', column: 'faith' } },
  { op: 'group', id: 'summary', input: 'faithful', by: ['culture', 'faith'], aggregates: [
    { op: 'count', as: 'groups' }, { op: 'sum', column: 'mass', as: 'population' },
  ] },
  { op: 'group', id: 'totals', input: 'summary', by: ['culture'], aggregates: [
    { op: 'sum', column: 'population', as: 'population' },
  ] },
]);
const elapsed = performance.now() - start;
assert.equal(perf.tables.totals.rows.length, 500);
console.log(`Алгебра множеств/мер: 500 случайных эталонных наборов, 100 сравнений мер, 150 сохраняющих популяцию разбиений; полный пакет 25 000 строк — ${elapsed.toFixed(2)} мс.`);
