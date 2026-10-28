import { Feather, FontAwesome } from '@expo/vector-icons';
import type { Href } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { CityIconLink, DynastyEmblemLink, EntityFlagLink } from '@/components/profiles/EntityMarks';
import { findChronicleMentions, type ChronicleEntry, type ChronicleObjectOption, type ChronicleReference } from '@/game/chronicle';
import {
  cityProfileRoute,
  countryProfileRoute,
  cultureProfileRoute,
  religionProfileRoute,
} from '@/game/profileRoutes';
import { openProfile } from '@/game/profileNavigation';
import type { City, World } from '@/game/world';
import type { FlagSpec } from '@/game/flagSpec';

const c = colors.light;

type MentionEntity = {
  reference: ChronicleReference;
  name: string;
  kind: ChronicleReference['type'];
  href: Href;
  spec?: FlagSpec;
  city?: City;
  hasPort?: boolean;
  familyId?: number;
  dynastySpec?: FlagSpec;
};

function entityForReference(world: World, reference: ChronicleReference): MentionEntity | null {
  if (reference.type === 'country') {
    const country = world.countries[reference.id];
    return country ? {
      reference,
      name: country.name,
      kind: 'country',
      href: countryProfileRoute(country.id),
      spec: country.emblemSpec,
    } : null;
  }
  if (reference.type === 'religion') {
    const religion = world.religions[reference.id];
    return religion ? {
      reference,
      name: religion.name,
      kind: 'religion',
      href: religionProfileRoute(religion.id),
      spec: religion.emblemSpec,
    } : null;
  }
  if (reference.type === 'culture') {
    const culture = world.cultures[reference.id];
    return culture ? {
      reference,
      name: culture.name,
      kind: 'culture',
      href: cultureProfileRoute(culture.id),
    } : null;
  }
  if (reference.type === 'person') {
    const person = world.people.find((item) => item.id === reference.id);
    return person ? {
      reference,
      name: person.name,
      kind: 'person',
      href: { pathname: '/person/[id]', params: { id: String(person.id) } },
      familyId: person.familyId,
      dynastySpec: world.dynastyEmblems[person.familyId]?.emblemSpec,
    } : null;
  }
  const city = world.cities.find((item) => item.chronicleId === reference.id);
  if (!city) return null;
  return {
    reference,
    name: city.name ?? `Город ${city.id + 1}`,
    kind: 'city',
    href: cityProfileRoute(city.id),
    city,
    hasPort: world.isCoastal(city.pixel) || world.knownRivers[city.pixel] > 0,
  };
}

function sameReference(a: ChronicleReference, b: ChronicleReference): boolean {
  return a.type === b.type && a.id === b.id;
}

function stripCountryPrefix(text: string, countryName: string): string {
  const escapedName = countryName.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return text.replace(new RegExp(`^${escapedName}(?:(?:\\s*[:—–-]\\s*)|\\s+)`, 'u'), '');
}

function InlineMark({ entity }: { entity: MentionEntity }) {
  if (entity.kind === 'country' || entity.kind === 'religion') {
    return entity.spec
      ? <EntityFlagLink spec={entity.spec} href={entity.href} label={entity.name} size={16} />
      : (
        <Pressable onPress={() => openProfile(entity.href)} style={styles.inlineMark}
          accessibilityRole="link" accessibilityLabel={`Открыть карточку: ${entity.name}`}>
          <Feather name="flag" size={13} color={c.accent} />
        </Pressable>
      );
  }
  if (entity.kind === 'city' && entity.city) {
    return <CityIconLink city={entity.city} hasPort={!!entity.hasPort} label={entity.name} size={16} />;
  }
  const icon: ReactNode = entity.kind === 'culture'
    ? <FontAwesome name="columns" size={13} color={c.accent} />
    : <Feather name="user" size={13} color={c.accent} />;
  if (entity.kind === 'person') {
    return (
      <View style={styles.personMarks}>
        {entity.familyId !== undefined && entity.dynastySpec
          ? <DynastyEmblemLink spec={entity.dynastySpec} familyId={entity.familyId}
            focusPersonId={entity.reference.id} label={entity.name} size={16} />
          : null}
        <Pressable onPress={() => openProfile(entity.href)} style={styles.inlineMark}
          accessibilityRole="link" accessibilityLabel={`Открыть карточку: ${entity.name}`}>
          {icon}
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable onPress={() => openProfile(entity.href)} style={styles.inlineMark}
      accessibilityRole="link" accessibilityLabel={`Открыть карточку: ${entity.name}`}>
      {icon}
    </Pressable>
  );
}

function FilterButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.filterButton} hitSlop={4}
      accessibilityRole="button" accessibilityLabel={`Оставить в летописи события с участием: ${label}`}>
      <Feather name="filter" size={11} color={c.primary} />
    </Pressable>
  );
}

export function ChronicleMessage({
  entry,
  world,
  objectOptions = [],
  selectedReferences,
  initialReference,
  onAddReference,
  minimal = false,
}: {
  entry: ChronicleEntry;
  world?: World;
  objectOptions?: ChronicleObjectOption[];
  selectedReferences: ChronicleReference[];
  initialReference?: ChronicleReference | null;
  onAddReference: (reference: ChronicleReference) => void;
  minimal?: boolean;
}) {
  const entities: MentionEntity[] = [];
  if (world) {
    const seen = new Set<string>();
    for (const reference of entry.objects) {
      const key = `${reference.type}:${reference.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entity = entityForReference(world, reference);
      if (entity) entities.push(entity);
    }
  }
  const sourceCountry = entry.scope === 'country' && world && entry.scopeCountryId !== undefined
    ? world.countries[entry.scopeCountryId]
    : undefined;
  const text = sourceCountry ? stripCountryPrefix(entry.text, sourceCountry.name) : entry.text;
  const mentions = findChronicleMentions(text, entities.map(({ reference, name }) => ({ reference, name })));
  const sourceEntity = world && entry.scope === 'country' && entry.scopeCountryId !== undefined
    ? entityForReference(world, { type: 'country', id: entry.scopeCountryId })
    : null;
  const offerFilter = (reference: ChronicleReference) =>
    !selectedReferences.some((active) => sameReference(active, reference)) &&
    !(initialReference && sameReference(initialReference, reference));
  const segments: ({ text: string } | { entity: MentionEntity; name: string })[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    const entity = entities.find(({ reference }) => sameReference(reference, mention.reference));
    if (!entity) continue;
    if (mention.start > cursor) segments.push({ text: text.slice(cursor, mention.start) });
    segments.push({ entity, name: mention.name });
    cursor = mention.end;
  }
  if (cursor < text.length || !segments.length) segments.push({ text: text.slice(cursor) });
  const messageStyle = minimal ? styles.minimalText : styles.text;
  const optionLabel = (reference: ChronicleReference) =>
    objectOptions.find(({ reference: optionReference }) => sameReference(optionReference, reference))?.label;

  return (
    <View style={styles.messageLine} testID="chronicle-message">
      {entry.scope === 'world' ? (
        <Feather name="globe" size={14} color={minimal ? '#f5eee8' : c.accent} style={styles.leadingWorldMark} />
      ) : sourceEntity ? (
        <>
          <InlineMark entity={sourceEntity} />
          {offerFilter(sourceEntity.reference) && (
            <FilterButton label={sourceEntity.name} onPress={() => onAddReference(sourceEntity.reference)} />
          )}
        </>
      ) : null}
      {segments.map((segment, index) => 'entity' in segment ? (
        <View key={`entity-${segment.entity.reference.type}-${segment.entity.reference.id}-${index}`} style={styles.inlineMention}>
          <InlineMark entity={segment.entity} />
          <Text style={messageStyle}>{segment.name}</Text>
          {offerFilter(segment.entity.reference) && (
            <FilterButton label={optionLabel(segment.entity.reference) ?? segment.entity.name}
              onPress={() => onAddReference(segment.entity.reference)} />
          )}
        </View>
      ) : (
        <Text key={`text-${index}`} style={messageStyle}>{segment.text}</Text>
      ))}
    </View>
  );
}

export const chronicleReferencesEqual = sameReference;

const styles = {
  messageLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', flex: 1, minWidth: 0, columnGap: 2, rowGap: 1 } as const,
  inlineMention: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 1 } as const,
  personMarks: { flexDirection: 'row', alignItems: 'center', flexShrink: 0, gap: 1 } as const,
  inlineMark: { minWidth: 16, height: 17, alignItems: 'center', justifyContent: 'center' } as const,
  leadingWorldMark: { marginRight: 3 } as const,
  filterButton: { width: 15, height: 18, alignItems: 'center', justifyContent: 'center', marginRight: 1 } as const,
  text: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: c.secondaryForeground } as const,
  minimalText: { flexShrink: 1, fontFamily: fonts.sans, fontSize: 14, lineHeight: 20, color: '#f5eee8' } as const,
};
