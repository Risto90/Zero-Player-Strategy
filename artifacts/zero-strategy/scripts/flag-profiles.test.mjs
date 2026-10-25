import assert from 'node:assert/strict';
import {
  FLAG_CULTURE_PROFILE_BINDINGS,
  FLAG_PROFILE_CONFIG,
  FLAG_PROFILE_DEFAULTS,
} from '../game/flagProfileConfig.ts';
import {
  areFlagTagSetsCompatible,
  availableFlagProfiles,
  canUseHybridProfiles,
  chooseFlagProfileMode,
  chooseFlagProfileWeight,
  chooseHybridProfile,
  flagTagsCompatible,
  getFlagProfile,
  isPureFlagStyle,
  mixHybridProfileProperties,
} from '../game/flagProfiles.ts';

assert.equal(FLAG_PROFILE_CONFIG.length, 32);
assert.deepEqual(FLAG_PROFILE_CONFIG.map(({ id }) => id), Array.from({ length: 32 }, (_, index) => `P${String(index + 1).padStart(2, '0')}`));
assert.ok(FLAG_PROFILE_CONFIG.every((profile) => profile.CHG?.groups?.[0] === 0 && profile.CHG.groups[1] === 3));
assert.deepEqual(FLAG_CULTURE_PROFILE_BINDINGS, {}, 'game-culture mappings remain unassigned until specified');
assert.equal(FLAG_PROFILE_DEFAULTS.purity, 0.88);
assert.equal(FLAG_PROFILE_DEFAULTS.hybridProbability, 0);
assert.equal(getFlagProfile('P04').CHG.anchors.A5, 3);
assert.equal(getFlagProfile('P05').CHG.counterchange_weight, 2);
assert.equal(getFlagProfile('P14').CHG.probability_any, 0.1);
assert.equal(getFlagProfile('P19').CHG.probability_any, 0.05);
assert.equal(getFlagProfile('P30').tags_allowed, null, 'profile names do not create cultural tag assignments');
assert.deepEqual(availableFlagProfiles(0).map(({ id }) => id), ['P01', 'P02', 'P30']);
assert.deepEqual(availableFlagProfiles(7), []);

assert.equal(flagTagsCompatible('christian', 'islamic'), false);
assert.equal(flagTagsCompatible('socialist', 'royal', true), false, 'forbidden pairs remain forbidden in hybrids');
assert.equal(flagTagsCompatible('steppe', 'islamic'), false);
assert.equal(flagTagsCompatible('steppe', 'islamic', true), true);
assert.equal(flagTagsCompatible('maritime', 'royal'), false);
assert.equal(flagTagsCompatible('maritime', 'royal', true), true);
assert.equal(flagTagsCompatible('neutral', 'dharmic'), true);
assert.equal(areFlagTagSetsCompatible(['steppe', 'islamic'], true), true);
assert.equal(isPureFlagStyle(getFlagProfile('P08'), ['islamic']).valid, true);
assert.equal(isPureFlagStyle(getFlagProfile('P08'), ['christian']).valid, false);
assert.equal(canUseHybridProfiles(getFlagProfile('P09'), getFlagProfile('P08')).valid, true);
assert.equal(chooseHybridProfile(getFlagProfile('P09'), 2, () => 0)?.id, 'P08');
assert.equal(chooseHybridProfile(getFlagProfile('P09'), 4, () => 0), null, 'second profile must be available in the chosen era');
assert.equal(chooseHybridProfile(getFlagProfile('P08'), 2, () => 0), null, 'only configured HYB partners can be selected');

assert.equal(chooseFlagProfileMode(() => 0.1), 'pure');
assert.equal(chooseFlagProfileMode(() => 0.9), 'unresolved', 'unspecified profile mode probability is not guessed');
assert.equal(chooseFlagProfileMode(() => 0.9, 0.88, 0.12), 'hybrid');
assert.throws(() => chooseFlagProfileMode(() => 0.5, 0.9, 0.2), /sum to at most 1/);

const primary = getFlagProfile('P09');
const second = getFlagProfile('P08');
const mixed = mixHybridProfileProperties(primary, second, (() => {
  const values = [0.8, 0.2];
  return () => values.shift();
})());
assert.equal(mixed.OUT, primary.OUT);
assert.equal(mixed.PAL, primary.PAL);
assert.equal(mixed.fieldAndOrdinaries.sourceProfileId, second.id);
assert.equal(mixed.charges.sourceProfileId, primary.id);
assert.equal(chooseFlagProfileWeight({ first: 1, second: 3 }, () => 0.25), 'second');
assert.throws(() => chooseFlagProfileWeight({ option: null }, () => 0.1), /non-negative finite weights/);
assert.throws(() => chooseFlagProfileWeight(null, () => 0.1), /not specified/);
