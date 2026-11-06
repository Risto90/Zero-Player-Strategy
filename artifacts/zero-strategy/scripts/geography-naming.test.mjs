import assert from 'node:assert/strict';
import './binary-kernel-test-setup.mjs';
import { drawCountryCard, setCardDrawTraceListener } from '../game/cards.ts';
import { MAP_WIDTH } from '../game/config.ts';
import { World } from '../game/world.ts';

const world = World.create('random', 199_001);
const [insideRiverPixel, insidePeakPixel] = Array.from(world.landIndex.slice(0, 2));
const insideX = insideRiverPixel % MAP_WIDTH;
const insideY = Math.floor(insideRiverPixel / MAP_WIDTH);
const outsidePixel = world.landIndex.find((pixel) =>
  Math.abs(pixel % MAP_WIDTH - insideX) > 80 ||
  Math.abs(Math.floor(pixel / MAP_WIDTH) - insideY) > 80);
assert.notEqual(outsidePixel, undefined, 'для проверки есть географический объект вне территории');
const culture = world.newCulture(null, 1000);
const country = world.newCountry({
  rank: 'test',
  cultureId: culture.id,
  religionId: null,
  density: 10,
  foundedYear: 1000,
  parentId: null,
});
const neighbor = world.newCountry({
  rank: 'test',
  cultureId: culture.id,
  religionId: null,
  density: 10,
  foundedYear: 1000,
  parentId: null,
});

world.setOwner(insideRiverPixel, country.id + 1);
world.setOwner(insidePeakPixel, country.id + 1);
world.setOwner(outsidePixel, neighbor.id + 1);

const pathThrough = (pixel) => {
  const x = pixel % MAP_WIDTH;
  const y = Math.floor(pixel / MAP_WIDTH);
  return [[{ x: x + 0.2, y: y + 0.5 }, { x: x + 0.8, y: y + 0.5 }]];
};
world.riverFeatures = [
  { id: 0, scaleRank: 2, paths: pathThrough(insideRiverPixel), pixels: [outsidePixel], name: null },
  { id: 1, scaleRank: 2, paths: pathThrough(outsidePixel), pixels: [insideRiverPixel], name: null },
];
world.peaks = [
  { id: 0, pixel: insidePeakPixel, elevation: 1200, name: null },
  { id: 1, pixel: outsidePixel, elevation: 900, name: null },
];
world.volcanoes = [
  { id: 0, pixel: outsidePixel, elevation: 2400, name: null, active: false },
  { id: 1, pixel: insidePeakPixel, elevation: 1700, name: null, active: false },
];

const targetKeys = (countryId) => world.unnamedGeographyForCountry(countryId)
  .map(({ kind, id }) => `${kind}:${id}`)
  .sort();
assert.deepEqual(targetKeys(country.id), ['peak:0', 'river:0', 'volcano:1'],
  'точки горы и вулкана проверяются по контуру, река — по контуру русла');

const traces = [];
setCardDrawTraceListener((event) => traces.push(event));
try {
  const multiplierKey = `country:${country.id}:nameGeography`;
  world.cardMultipliers[multiplierKey] = 25;
  drawCountryCard(world, country, 1000);
  const nameOption = traces.at(-1).choices.find(({ key }) => key === 'nameGeography');
  assert.equal(nameOption?.programmedWeight, 3,
    'численный вес карты равен числу подходящих безымянных объектов');
  assert.equal(nameOption?.adaptiveMultiplier, 1,
    'накопительный множитель не меняет заданный числом вес');
  assert.equal(world.cardMultipliers[multiplierKey], 25,
    'именование не изменяет и не применяет накопительный множитель');

  world.setOwner(insidePeakPixel, neighbor.id + 1);
  assert.deepEqual(targetKeys(country.id), ['river:0'],
    'смена владельца точки удаляет гору и вулкан из набора целей');
  drawCountryCard(world, country, 1001);
  assert.equal(traces.at(-1).choices.find(({ key }) => key === 'nameGeography')?.programmedWeight, 1,
    'вес обновляется после изменения территории');

  world.setOwner(insideRiverPixel, neighbor.id + 1);
  assert.deepEqual(targetKeys(country.id), [],
    'чужие точки и реки не попадают в набор целей страны');
  drawCountryCard(world, country, 1002);
  assert.equal(traces.at(-1).choices.some(({ key }) => key === 'nameGeography'), false,
    'карта именования отсутствует, когда подходящих объектов нет');
} finally {
  setCardDrawTraceListener(null);
}

const nomad = world.newCountry({
  rank: 'test',
  cultureId: culture.id,
  religionId: null,
  density: 10,
  foundedYear: 1000,
  parentId: null,
});
nomad.type = 'nomadic';
nomad.range = [outsidePixel];
world.markNomadicRangeExpanded();
assert.deepEqual(
  targetKeys(nomad.id),
  ['peak:1', 'river:1', 'volcano:0'],
  'ареал кочевой страны задаёт тот же контурный набор целей',
);

console.log('Проверено контурное именование географических объектов.');
