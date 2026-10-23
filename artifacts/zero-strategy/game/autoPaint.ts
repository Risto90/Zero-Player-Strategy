import type { CardPainter } from './brush';
import { MAP_HEIGHT, MAP_WIDTH } from './config';

/**
 * Plays a card automatically: brush dabs grow a blob outward from the card's hint pixel,
 * each dab placed near a random point already painted, until the ink runs out.
 */
export function autoPaint(painter: CardPainter): void {
  const card = painter.card;
  if (card.hint < 0) return;
  const territorial = card.type === 'create' || card.type === 'expand' || card.type === 'colonization' || card.type === 'split';
  const radius = territorial ? 10 : 16;
  let misses = 0;
  let x = (card.hint % MAP_WIDTH) + 0.5;
  let y = Math.floor(card.hint / MAP_WIDTH) + 0.5;
  for (let step = 0; step < 4000 && card.ink > 0; step += 1) {
    const spent = painter.dab(x, y, radius);
    misses = spent > 0 ? 0 : misses + 1;
    if (misses > 80) break;
    // Recently painted pixels lie near the edge of the blob, so growing from them keeps it compact.
    const changed = painter.changed;
    const from = changed.length > 0 ? changed[changed.length - 1 - Math.floor(Math.random() * Math.min(changed.length, 600))] : card.hint;
    const angle = Math.random() * Math.PI * 2;
    const distance = radius * (0.6 + Math.random() * 0.8);
    x = Math.min(MAP_WIDTH - 1, Math.max(0, (from % MAP_WIDTH) + 0.5 + Math.cos(angle) * distance));
    y = Math.min(MAP_HEIGHT - 1, Math.max(0, Math.floor(from / MAP_WIDTH) + 0.5 + Math.sin(angle) * distance));
  }
  if (card.type === 'warmWind' || card.type === 'coldWind') {
    painter.line(x, y, (card.hint % MAP_WIDTH) + 0.5, Math.floor(card.hint / MAP_WIDTH) + 0.5, radius);
  }
  painter.endStroke();
}
