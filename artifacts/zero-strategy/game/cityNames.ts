import { legacyNameStyleForCulture, legacySurnameAffixForCulture, type NameStyleId } from './government';
import type { World } from './world';

const SYLLABLES = [
  'а', 'бе', 'бо', 'да', 'де', 'ди', 'до', 'ду', 'э', 'га', 'ге', 'ги', 'го', 'гу',
  'ка', 'ке', 'ки', 'ко', 'ку', 'ла', 'ле', 'ли', 'ло', 'лу', 'ма', 'ме', 'ми', 'мо',
  'на', 'не', 'ни', 'но', 'ну', 'ра', 'ре', 'ри', 'ро', 'ру', 'са', 'се', 'си', 'со',
  'та', 'те', 'ти', 'то', 'ту', 'ва', 'ве', 'ви', 'во', 'ву', 'жа', 'же', 'жи', 'жо',
];

function syllable(): string {
  return SYLLABLES[Math.floor(Math.random() * SYLLABLES.length)];
}

function stem(count = 2 + Math.floor(Math.random() * 2)): string {
  let value = '';
  for (let i = 0; i < count; i += 1) value += syllable();
  return value;
}

function styledName(style: NameStyleId, affix: { position: 'prefix' | 'suffix'; text: string }): string {
  const first = stem();
  const second = stem(2);
  switch (style) {
    case 'family-given':
      return `${affix.text}${first}`;
    case 'russian-patronymic':
      return `${first}${syllable()}${affix.text}`;
    case 'spanish-double-surname':
      return `${first}${affix.text} ${second}`;
    case 'icelandic-patronymic':
      return `${first}${syllable()}${affix.text}`;
    case 'arabic-nasab':
      return `${first} ${affix.text} ${second}`;
    default:
      return `${first}${affix.text}`;
  }
}

/** City names are generated from the leading culture and never change after founding. */
export function generateCityIdentity(world: World, pixel: number): {
  name: string;
  namingCultureId: number;
  namingStyleId: NameStyleId;
} {
  const mix = world.cultureTable.entries[world.culture[pixel]];
  let leadingIndex = 0;
  for (let i = 1; i < mix.ids.length; i += 1) {
    if (mix.shares[i] > mix.shares[leadingIndex]) leadingIndex = i;
  }
  const namingCultureId = mix.ids[leadingIndex] ?? 0;
  const culture = world.cultures[namingCultureId];
  const namingStyleId = culture?.nameStyleId ?? legacyNameStyleForCulture(namingCultureId);
  const affix = culture?.surnameAffix ?? legacySurnameAffixForCulture(namingCultureId);
  const used = new Set(world.cities.map((city) => city.name?.toLocaleLowerCase('ru-RU')).filter(Boolean));

  let name = '';
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = styledName(namingStyleId, affix);
    if (!used.has(candidate.toLocaleLowerCase('ru-RU'))) {
      name = candidate;
      break;
    }
  }
  if (!name) {
    let serial = world.cities.length + 1;
    do {
      name = `${stem(3)}${syllable()}${serial++}`;
    } while (used.has(name.toLocaleLowerCase('ru-RU')));
  }
  name = name.charAt(0).toLocaleUpperCase('ru-RU') + name.slice(1);
  return { name, namingCultureId, namingStyleId };
}
