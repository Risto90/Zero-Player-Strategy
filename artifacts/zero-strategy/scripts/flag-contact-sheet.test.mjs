import assert from 'node:assert/strict';
import { FLAG_REFERENCE_CORPUS } from '../game/flagReferences.ts';
import { renderFlagContactSheet } from '../game/flagContactSheet.ts';

const specs = FLAG_REFERENCE_CORPUS.map(({ spec }) => spec);
const html = renderFlagContactSheet(specs, { title: 'Контроль эталонных флагов', columns: 3 });

assert.match(html, /<html lang="ru">/);
assert.match(html, /Контроль эталонных флагов/u);
assert.match(html, /51 флагов/u);
assert.match(html, /grid-template-columns:repeat\(3,/u);
assert.equal((html.match(/<figure>/gu) ?? []).length, specs.length, 'для каждого FlagSpec создаётся карточка');
assert.equal((html.match(/data:image\/svg\+xml;charset=utf-8,/gu) ?? []).length, specs.length, 'SVG встроены автономно');
assert.ok(!html.includes('<script'), 'контактный лист не содержит исполняемого кода');
assert.throws(() => renderFlagContactSheet([]), /непустой список/u);
assert.throws(() => renderFlagContactSheet(specs, { columns: 0 }), /Число колонок/u);
assert.throws(() => renderFlagContactSheet([{ ...specs[0], era: 99 }]), /не соответствует FlagSpec/u);

console.log('Проверки автономного контактного листа пройдены.');
