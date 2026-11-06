import type { FlagProfileId } from './flagProfiles';
import { FLAG_GENERATOR_CONFIG } from './flagGeneratorConfig';

export type FlagGenerationPurpose = 'country-flag' | 'religion-symbol' | 'city-coat' | 'culture-style' | 'dynasty-coat';
export type FlagEntityType = 'country' | 'religion' | 'city' | 'culture' | 'dynasty';

/**
 * Правила связи игровых данных со стилями. Пустые таблицы означают равные веса
 * всех совместимых профилей; эпоха выбирается среди разрешённых профилю.
 */
export const FLAG_IDENTITY_CONFIG = {
  generatorVersion: FLAG_GENERATOR_CONFIG.generatorVersion,
  profileWeightsByPurpose: {
    'country-flag': {} as Partial<Record<FlagProfileId, number>>,
    'religion-symbol': {} as Partial<Record<FlagProfileId, number>>,
    'city-coat': {} as Partial<Record<FlagProfileId, number>>,
    'culture-style': {} as Partial<Record<FlagProfileId, number>>,
    'dynasty-coat': {} as Partial<Record<FlagProfileId, number>>,
  } satisfies Record<FlagGenerationPurpose, Partial<Record<FlagProfileId, number>>>,
  cultureProfilesById: {} as Record<number, FlagProfileId>,
  cultureTagsById: {} as Record<number, string[]>,
  religionParentSource: 'none' as 'none' | 'current-country',
  relatedVariationAttempts: 4,
  variationPolicy: {
    dimensions: ['field', 'palette', 'ordinaries', 'emblems'],
    weights: {} as Record<string, number>,
    ranges: {} as Record<string, readonly [number, number]>,
  },
} as const;
