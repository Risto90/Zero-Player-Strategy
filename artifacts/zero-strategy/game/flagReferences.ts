import { FLAG_COLOR_CONFIG } from './flagColorConfig';
import { structureHash, visualHash } from './flagNovelty';
import type { FlagNode, FlagSpec, JsonObject } from './flagSpec';

interface ReferenceDesign {
  id: string;
  name: string;
  aspect: number;
  colors: string[];
  layout: 'H3' | 'V3' | 'H2' | 'V2' | 'PALE' | 'FESS' | 'BEND' | 'SOLID' | 'NORDIC' | 'QUARTER';
  emblem?: 'disc' | 'star' | 'crescent' | 'sun' | 'cross' | 'union' | 'triangle' | 'shield';
}

/** 51 эталонная композиция: названия и цвета соответствуют реальным флагам, мелкие детали упрощены. */
const REFERENCE_DESIGNS: readonly ReferenceDesign[] = [
  { id: 'japan', name: 'Япония', aspect: 1.5, colors: ['white', 'red'], layout: 'SOLID', emblem: 'disc' },
  { id: 'bangladesh', name: 'Бангладеш', aspect: 1.6, colors: ['green_dark', 'red'], layout: 'SOLID', emblem: 'disc' },
  { id: 'sweden', name: 'Швеция', aspect: 1.6, colors: ['azure', 'gold'], layout: 'NORDIC' },
  { id: 'denmark', name: 'Дания', aspect: 1.375, colors: ['red', 'white'], layout: 'NORDIC' },
  { id: 'norway', name: 'Норвегия', aspect: 1.375, colors: ['red', 'white', 'azure'], layout: 'NORDIC' },
  { id: 'iceland', name: 'Исландия', aspect: 1.375, colors: ['azure', 'white', 'red'], layout: 'NORDIC' },
  { id: 'finland', name: 'Финляндия', aspect: 1.636, colors: ['white', 'azure'], layout: 'NORDIC' },
  { id: 'united-kingdom', name: 'Великобритания', aspect: 2, colors: ['azure', 'white', 'red'], layout: 'QUARTER', emblem: 'union' },
  { id: 'greece', name: 'Греция', aspect: 1.5, colors: ['azure', 'white'], layout: 'H3', emblem: 'cross' },
  { id: 'australia', name: 'Австралия', aspect: 2, colors: ['azure', 'white', 'red'], layout: 'QUARTER', emblem: 'star' },
  { id: 'new-zealand', name: 'Новая Зеландия', aspect: 2, colors: ['azure', 'white', 'red'], layout: 'SOLID', emblem: 'star' },
  { id: 'united-states', name: 'США', aspect: 1.9, colors: ['red', 'white', 'azure'], layout: 'H3', emblem: 'star' },
  { id: 'liberia', name: 'Либерия', aspect: 1.9, colors: ['red', 'white', 'azure'], layout: 'H3', emblem: 'star' },
  { id: 'malaysia', name: 'Малайзия', aspect: 2, colors: ['red', 'white', 'azure'], layout: 'H3', emblem: 'crescent' },
  { id: 'turkey', name: 'Турция', aspect: 1.5, colors: ['red', 'white'], layout: 'SOLID', emblem: 'crescent' },
  { id: 'tunisia', name: 'Тунис', aspect: 1.5, colors: ['red', 'white'], layout: 'SOLID', emblem: 'crescent' },
  { id: 'pakistan', name: 'Пакистан', aspect: 1.5, colors: ['green_dark', 'white'], layout: 'V2', emblem: 'crescent' },
  { id: 'algeria', name: 'Алжир', aspect: 1.5, colors: ['vert', 'white', 'red'], layout: 'V2', emblem: 'crescent' },
  { id: 'singapore', name: 'Сингапур', aspect: 2, colors: ['red', 'white'], layout: 'H2', emblem: 'crescent' },
  { id: 'switzerland', name: 'Швейцария', aspect: 1, colors: ['red', 'white'], layout: 'SOLID', emblem: 'cross' },
  { id: 'tonga', name: 'Тонга', aspect: 2, colors: ['red', 'white'], layout: 'SOLID', emblem: 'cross' },
  { id: 'czechia', name: 'Чехия', aspect: 1.5, colors: ['white', 'red', 'azure'], layout: 'H2', emblem: 'triangle' },
  { id: 'cuba', name: 'Куба', aspect: 2, colors: ['azure', 'white', 'red'], layout: 'H3', emblem: 'star' },
  { id: 'philippines', name: 'Филиппины', aspect: 2, colors: ['azure', 'red', 'white', 'gold'], layout: 'H2', emblem: 'sun' },
  { id: 'jamaica', name: 'Ямайка', aspect: 2, colors: ['black', 'gold', 'vert'], layout: 'BEND' },
  { id: 'trinidad-and-tobago', name: 'Тринидад и Тобаго', aspect: 1.5, colors: ['red', 'black', 'white'], layout: 'SOLID' },
  { id: 'bahamas', name: 'Багамы', aspect: 2, colors: ['sky', 'gold', 'black'], layout: 'H3', emblem: 'triangle' },
  { id: 'kuwait', name: 'Кувейт', aspect: 2, colors: ['green_dark', 'white', 'red', 'black'], layout: 'H3' },
  { id: 'jordan', name: 'Иордания', aspect: 2, colors: ['black', 'white', 'vert', 'red'], layout: 'H3', emblem: 'star' },
  { id: 'egypt', name: 'Египет', aspect: 1.5, colors: ['red', 'white', 'black', 'gold'], layout: 'H3', emblem: 'sun' },
  { id: 'germany', name: 'Германия', aspect: 1.667, colors: ['black', 'red', 'gold'], layout: 'H3' },
  { id: 'france', name: 'Франция', aspect: 1.5, colors: ['azure', 'white', 'red'], layout: 'V3' },
  { id: 'italy', name: 'Италия', aspect: 1.5, colors: ['vert', 'white', 'red'], layout: 'V3' },
  { id: 'netherlands', name: 'Нидерланды', aspect: 1.5, colors: ['red', 'white', 'azure'], layout: 'H3' },
  { id: 'russia', name: 'Россия', aspect: 1.5, colors: ['white', 'azure', 'red'], layout: 'H3' },
  { id: 'poland', name: 'Польша', aspect: 1.6, colors: ['white', 'red'], layout: 'H2' },
  { id: 'brazil', name: 'Бразилия', aspect: 1.4, colors: ['vert', 'gold', 'azure', 'white'], layout: 'SOLID', emblem: 'disc' },
  { id: 'argentina', name: 'Аргентина', aspect: 1.5, colors: ['sky', 'white', 'gold'], layout: 'H3', emblem: 'sun' },
  { id: 'uruguay', name: 'Уругвай', aspect: 1.5, colors: ['white', 'azure', 'gold'], layout: 'H3', emblem: 'sun' },
  { id: 'chile', name: 'Чили', aspect: 1.5, colors: ['white', 'red', 'azure'], layout: 'H2', emblem: 'star' },
  { id: 'colombia', name: 'Колумбия', aspect: 1.5, colors: ['gold', 'azure', 'red'], layout: 'H3' },
  { id: 'ethiopia', name: 'Эфиопия', aspect: 2, colors: ['vert', 'gold', 'red'], layout: 'H3', emblem: 'disc' },
  { id: 'ghana', name: 'Гана', aspect: 1.5, colors: ['red', 'gold', 'vert', 'black'], layout: 'H3', emblem: 'star' },
  { id: 'south-africa', name: 'ЮАР', aspect: 1.5, colors: ['red', 'white', 'azure', 'black', 'gold'], layout: 'BEND' },
  { id: 'nepal', name: 'Непал', aspect: 0.82, colors: ['red', 'azure', 'white'], layout: 'SOLID', emblem: 'sun' },
  { id: 'ohio', name: 'Огайо', aspect: 1.5, colors: ['red', 'white', 'azure'], layout: 'H3', emblem: 'star' },
  { id: 'mongolia', name: 'Монголия', aspect: 2, colors: ['red', 'azure', 'gold'], layout: 'V3', emblem: 'sun' },
  { id: 'uzbekistan', name: 'Узбекистан', aspect: 2, colors: ['sky', 'white', 'vert', 'red'], layout: 'H3', emblem: 'crescent' },
  { id: 'seychelles', name: 'Сейшелы', aspect: 1.5, colors: ['azure', 'gold', 'red', 'white', 'vert'], layout: 'BEND' },
  { id: 'croatia', name: 'Хорватия', aspect: 2, colors: ['red', 'white', 'azure', 'gold'], layout: 'H3', emblem: 'shield' },
  { id: 'scotland', name: 'Шотландия', aspect: 1.5, colors: ['azure', 'white'], layout: 'SOLID', emblem: 'cross' },
];

const COLOR_HEX = new Map<string, string>(FLAG_COLOR_CONFIG.colors.flatMap((entry) =>
  entry.shades.map((shade) => [shade.id, shade.hex] as [string, string])));

function fill(slot: string): FlagNode {
  return { kind: 'fill', fill: slot };
}

function layer(id: string, role: 'ordinary' | 'charge' | 'canton', shape: JsonObject, slot: string): FlagNode {
  return {
    kind: 'layer',
    layer: {
      id,
      role,
      shape,
      transform: { translate: { u: 0, v: 0 }, rotate: 0, scale: 1 },
      fill: slot,
      clip: ['flag-outline'],
      tags: [role],
      cost: 1,
    },
  };
}

function createGround(design: ReferenceDesign): FlagNode {
  const slots = design.colors.map((_, index) => `s${index + 1}`);
  if (design.layout === 'SOLID') return fill(slots[0]);
  if (design.layout === 'NORDIC') return fill(slots[0]);
  if (design.layout === 'QUARTER') {
    return {
      kind: 'split',
      op: 'G05',
      params: { point: { u: 0.5, v: 0.5 }, slot_pattern: 'AB/CD' },
      children: [fill(slots[0]), fill(slots[1] ?? slots[0]), fill(slots[2] ?? slots[0]), fill(slots[0])],
    };
  }
  if (design.layout === 'PALE' || design.layout === 'FESS' || design.layout === 'BEND') {
    return {
      kind: 'split',
      op: 'G04',
      params: { mode: design.layout, position: 0.5 },
      children: [fill(slots[0]), fill(slots[1] ?? slots[0])],
    };
  }
  const vertical = design.layout === 'V2' || design.layout === 'V3';
  const count = design.layout.endsWith('2') ? 2 : 3;
  return {
    kind: 'split',
    op: 'G02',
    params: { axis: vertical ? 'V' : 'H', weights: Array.from({ length: count }, () => 1), slot_pattern: 'DISTINCT' },
    children: Array.from({ length: count }, (_, index) => fill(slots[index] ?? slots[0])),
  };
}

function designLayers(design: ReferenceDesign): FlagNode[] {
  const colors = design.colors.map((_, index) => `s${index + 1}`);
  const layers: FlagNode[] = [];
  if (design.layout === 'NORDIC') {
    const main = colors[1] ?? colors[0];
    const under = colors[2] ?? colors[0];
    if (design.colors.length === 3) {
      layers.push(layer('cross-border-v', 'ordinary', { type: 'rectangle', x: 0.29, y: 0, w: 0.14, h: 1 }, under));
      layers.push(layer('cross-border-h', 'ordinary', { type: 'rectangle', x: 0, y: 0.43, w: 1, h: 0.14 }, under));
    }
    layers.push(layer('cross-v', 'ordinary', { type: 'rectangle', x: 0.32, y: 0, w: 0.08, h: 1 }, main));
    layers.push(layer('cross-h', 'ordinary', { type: 'rectangle', x: 0, y: 0.46, w: 1, h: 0.08 }, main));
  }
  if (design.emblem === 'cross') {
    layers.push(layer('cross-v', 'ordinary', { type: 'rectangle', x: 0.42, y: 0.3, w: 0.16, h: 0.4 }, colors[1] ?? colors[0]));
    layers.push(layer('cross-h', 'ordinary', { type: 'rectangle', x: 0.3, y: 0.42, w: 0.4, h: 0.16 }, colors[1] ?? colors[0]));
  }
  if (design.emblem === 'union') {
    layers.push(layer('union-v', 'canton', { type: 'rectangle', x: 0, y: 0, w: 0.48, h: 1 }, colors[1]));
    layers.push(layer('union-h', 'canton', { type: 'rectangle', x: 0, y: 0, w: 1, h: 0.48 }, colors[2] ?? colors[1]));
  }
  if (design.emblem === 'triangle') {
    layers.push(layer('triangle', 'charge', {
      type: 'polygon', module: 'POLYGON', points: [{ u: 0, v: 0 }, { u: 0.52, v: 0.5 }, { u: 0, v: 1 }],
    }, colors[2] ?? colors[1]));
  }
  if (design.emblem === 'shield') {
    layers.push(layer('emblem-shield', 'charge', {
      type: 'polygon',
      module: 'SHIELD',
      points: [{ u: 0.33, v: 0.28 }, { u: 0.67, v: 0.28 }, { u: 0.64, v: 0.62 }, { u: 0.5, v: 0.76 }, { u: 0.36, v: 0.62 }],
    }, colors[3] ?? colors[0]));
  }
  if (design.emblem === 'disc' || design.emblem === 'sun' || design.emblem === 'crescent') {
    const isCrescent = design.emblem === 'crescent';
    const emblemSlot = isCrescent ? colors[1] ?? colors[0] : colors[1] ?? colors[0];
    const mainModule = design.emblem === 'crescent' ? 'CRESCENT' : design.emblem === 'sun' ? 'SUN' : 'DISC';
    layers.push(layer('emblem-disc', 'charge', { type: 'circle', module: mainModule, cx: 0.5, cy: 0.5, radius: isCrescent ? 0.22 : 0.2 }, emblemSlot));
    if (isCrescent) {
      layers.push(layer('emblem-cutout', 'charge', { type: 'circle', module: 'DISC', cx: 0.58, cy: 0.45, radius: 0.18 }, colors[0]));
    }
    if (design.emblem === 'sun') {
      layers.push(layer('emblem-center', 'charge', { type: 'circle', module: 'DISC', cx: 0.5, cy: 0.5, radius: 0.09 }, colors[3] ?? colors[0]));
    }
  }
  if (design.emblem === 'star') {
    layers.push(layer('emblem-star', 'charge', {
      type: 'star', module: 'STAR', cx: 0.5, cy: 0.5, radius: 0.23, points_count: 10, inner_ratio: 0.42,
    }, colors[2] ?? colors[1]));
  }
  return layers;
}

function buildReference(design: ReferenceDesign): FlagSpec {
  const slots = design.colors.map((_, index) => `s${index + 1}`);
  const palette = Object.fromEntries(design.colors.map((color, index) => {
    const hex = COLOR_HEX.get(color);
    if (!hex) throw new Error(`Не найден цвет эталона: ${color}`);
    return [slots[index], { color_id: color, hex }];
  }));
  const spec: FlagSpec = {
    generator_version: 'reference-1',
    seed: design.id,
    profile_id: 'reference',
    era: 6,
    tags: ['reference'],
    outline: {
      type: 'RECT',
      params: {},
      aspect: design.aspect,
      safe_area: { margin: 1 / 30 },
    },
    slots: { items: slots, equalities: [] },
    palette,
    root: {
      x0: 0, y0: 0, w: 1, h: 1, clip: [],
      ground: createGround(design),
      layers: designLayers(design),
    },
    meta: { complexity: 2, symmetry: 'NONE', color_count: slots.length, structure_hash: 'pending', visual_hash: 'pending' },
  };
  spec.meta.structure_hash = structureHash(spec);
  spec.meta.visual_hash = visualHash(spec);
  return spec;
}

/** Эталонные флаги в машиночитаемой форме FlagSpec; сложная символика заменена простыми фигурами. */
export const FLAG_REFERENCE_CORPUS: readonly { id: string; name: string; spec: FlagSpec }[] =
  REFERENCE_DESIGNS.map((design) => ({ id: design.id, name: design.name, spec: buildReference(design) }));
