import type { Href } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import colors, { fonts } from '@/constants/colors';
import { CITY_ICON_SOURCES, cityIconIndex } from '@/components/map/cityIcons';
import { renderFlagSpec } from '@/game/flagRenderer';
import type { FlagSpec } from '@/game/flagSpec';
import { ATHEIST_FLAG_SVG } from '@/game/atheistFlag';
import type { City, Country } from '@/game/world';
import { cityProfileRoute, countryProfileRoute } from '@/game/profileRoutes';
import { openProfile } from '@/game/profileNavigation';

type EntityLinkProps = {
  spec?: FlagSpec;
  href: Href;
  label: string;
  size?: number;
  fit?: 'square' | 'height';
  testID?: string;
};

export function EntityFlagLink({ spec, href, label, size = 32, fit = 'square', testID }: EntityLinkProps) {
  if (!spec) return null;
  const xml = renderFlagSpec(spec);
  const ratio = Math.max(0.5, Math.min(2.6, Number(spec.outline.aspect) || 1));
  const width = fit === 'height' ? size * ratio : ratio >= 1 ? size : size * ratio;
  const height = fit === 'height' ? size : ratio >= 1 ? size / ratio : size;
  return (
    <Pressable onPress={() => openProfile(href)} style={[styles.markBox, { width: fit === 'height' ? width : size, height: fit === 'height' ? size : size }]}
      accessibilityRole="link" accessibilityLabel={`Открыть карточку: ${label}`} testID={testID}>
      <SvgXml xml={xml} width={width} height={height} />
    </Pressable>
  );
}

export function CityIconLink({ city, hasPort, label, size = 32, testID }: {
  city: City;
  hasPort: boolean;
  label?: string;
  size?: number;
  testID?: string;
}) {
  const icon = CITY_ICON_SOURCES[cityIconIndex(city, hasPort)] ?? CITY_ICON_SOURCES[0];
  const cityLabel = label ?? city.name ?? 'Город';
  return (
    <Pressable onPress={() => openProfile(cityProfileRoute(city.id))} style={[styles.markBox, { width: size, height: size }]}
      accessibilityRole="link" accessibilityLabel={`Открыть карточку города: ${cityLabel}`} testID={testID}>
      <Image source={icon} style={{ width: size, height: size }} resizeMode="contain" />
    </Pressable>
  );
}

export function EntityCrownLink({ href, label, size = 32 }: {
  href: Href;
  label: string;
  size?: number;
}) {
  return (
    <Pressable onPress={() => openProfile(href)} style={[styles.markBox, { width: size, height: size }]}
      accessibilityRole="link" accessibilityLabel={`Открыть карточку страны: ${label}`}>
      <MaterialCommunityIcons name="crown" size={size} color={colors.light.crownGold} />
    </Pressable>
  );
}

function dynastyEmblemDimensions(spec: FlagSpec, size: number) {
  const ratio = Math.max(0.5, Math.min(2.6, Number(spec.outline.aspect) || 1));
  return ratio >= 1
    ? { width: size, height: size / ratio }
    : { width: size * ratio, height: size };
}

export function DynastyEmblemMark({ spec, size = 32, testID }: {
  spec?: FlagSpec;
  size?: number;
  testID?: string;
}) {
  if (!spec) return null;
  const dimensions = dynastyEmblemDimensions(spec, size);
  return (
    <View style={[styles.markBox, { width: size, height: size }]} accessibilityLabel="Герб династии" testID={testID}>
      <SvgXml xml={renderFlagSpec(spec)} {...dimensions} />
    </View>
  );
}

export function DynastyEmblemLink({ spec, familyId, focusPersonId, label, size = 32, testID }: {
  spec?: FlagSpec;
  familyId: number;
  focusPersonId?: number;
  label: string;
  size?: number;
  testID?: string;
}) {
  if (!spec) return null;
  const dimensions = dynastyEmblemDimensions(spec, size);
  return (
    <Pressable
      onPress={(event) => {
        event.stopPropagation();
        openProfile({
          pathname: '/dynasty/[id]',
          params: {
            id: String(familyId),
            ...(focusPersonId === undefined ? {} : { person: String(focusPersonId) }),
          },
        });
      }}
      style={[styles.markBox, { width: size, height: size }]}
      accessibilityRole="link"
      accessibilityLabel={`Открыть древо династии ${label}`}
      testID={testID}
    >
      <SvgXml xml={renderFlagSpec(spec)} {...dimensions} />
    </Pressable>
  );
}

export function AtheistFlagMark({ size = 32, testID }: { size?: number; testID?: string }) {
  const width = size / 2;
  return (
    <View style={[styles.markBox, { width: size, height: size }]} accessibilityLabel="Флаг атеистов" testID={testID}>
      <SvgXml xml={ATHEIST_FLAG_SVG} width={width} height={size} />
    </View>
  );
}

export type ProfileEntityListItem =
  | { kind: 'country' | 'religion'; key: string; name: string; note?: string; spec?: FlagSpec; href: Href }
  | { kind: 'city'; key: string; city: City; hasPort: boolean; country?: Country }
  | { kind: 'atheists'; key: string; name: string; note?: string };

/** Единый рендерер списков стран, религий и городов в карточках сущностей. */
export function ProfileEntityList({ items, emptyText = 'Нет данных.' }: {
  items: ProfileEntityListItem[];
  emptyText?: string;
}) {
  return (
    <ScrollView style={styles.listScroll} contentContainerStyle={styles.list} nestedScrollEnabled>
      {items.length ? items.map((item) => (
        <View key={item.key} style={styles.row} testID={`entity-list-${item.kind}-${item.key}`}>
          {item.kind === 'country' || item.kind === 'religion' ? (
            <>
              <EntityFlagLink spec={item.spec} href={item.href} label={item.name} />
              <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
              {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
            </>
          ) : item.kind === 'city' ? (
            <>
              {item.city.capital && item.country ? (
                <EntityCrownLink href={countryProfileRoute(item.country.id)} label={item.country.name} />
              ) : null}
              {item.country?.emblemSpec ? (
                <EntityFlagLink spec={item.country.emblemSpec} href={countryProfileRoute(item.country.id)}
                  label={item.country.name} />
              ) : null}
              <CityIconLink city={item.city} hasPort={item.hasPort} />
              <Text style={styles.cityName} numberOfLines={1}>{item.city.name ?? `Город ${item.city.id + 1}`}</Text>
              {item.city.emblemSpec
                ? <EntityFlagLink spec={item.city.emblemSpec} href={cityProfileRoute(item.city.id)}
                  label={item.city.name ?? 'Город'} />
                : null}
            </>
          ) : (
            <>
              <AtheistFlagMark />
              <Text style={styles.name}>{item.name}</Text>
              {item.note ? <Text style={styles.note}>{item.note}</Text> : null}
            </>
          )}
        </View>
      )) : <Text style={styles.empty}>{emptyText}</Text>}
    </ScrollView>
  );
}

const c = colors.light;
const styles = StyleSheet.create({
  markBox: { alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  listScroll: { maxHeight: 190, flexGrow: 0, borderTopWidth: 1, borderBottomWidth: 1, borderColor: c.border },
  list: { paddingVertical: 4, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 32 },
  name: { flex: 1, fontFamily: fonts.sans, fontSize: 13, color: c.foreground },
  cityName: { flex: 1, minWidth: 0, fontFamily: fonts.sans, fontSize: 13, color: c.foreground },
  note: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
  empty: { paddingVertical: 5, fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
});
