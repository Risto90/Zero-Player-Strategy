import fs from 'node:fs/promises';
import path from 'node:path';
import { renderFlagContactSheet } from '../game/flagContactSheet.ts';
import { FLAG_REFERENCE_CORPUS } from '../game/flagReferences.ts';

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const [inputPath, outputPath] = args;
  if (!inputPath || !outputPath) {
    throw new Error('Использование: pnpm run flags:contact-sheet -- <флаги.json|--references> <контактный-лист.html>');
  }

  const fromCorpus = inputPath === '--references';
  const specs = fromCorpus
    ? FLAG_REFERENCE_CORPUS.map(({ spec }) => spec)
    : JSON.parse(await fs.readFile(inputPath, 'utf8'));
  if (!Array.isArray(specs)) throw new TypeError('Входной JSON должен содержать массив FlagSpec.');
  const html = renderFlagContactSheet(specs, {
    title: fromCorpus ? 'Эталонные флаги — не результаты генерации' : undefined,
  });
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(outputPath, html, 'utf8');
  console.log(`Создан контактный лист: ${specs.length} флагов → ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
