import { Feather } from '@expo/vector-icons';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { MAX_DENSITY } from '@/game/config';
import type { PixelInfo } from '@/game/game';
import type { World } from '@/game/world';
import { MODIFIERS, GOVERNMENTS, ageStage, governmentOf } from '@/game/government';
import { fmt } from '@/game/format';

const c = colors.light;

function Bar({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.barRow}>
      <Text style={styles.barLabel}>{label}</Text>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { width: `${value}%` }]} />
      </View>
      <Text style={styles.barValue}>{value}</Text>
    </View>
  );
}

type ShareRow = { id: number; name: string; color: string; share: number };

function Shares({ title, rows, extra }: { title: string; rows: ShareRow[]; extra?: { name: string; share: number } }) {
  return (
    <View>
      <Text style={styles.sharesTitle}>{title}</Text>
      <View style={styles.stack}>
        {rows.map((r) => (
          <View key={r.id} style={{ width: `${r.share}%`, backgroundColor: r.color }} />
        ))}
      </View>
      {rows.map((r) => (
        <View key={r.id} style={styles.shareRow}>
          <View style={[styles.dot, { backgroundColor: r.color }]} />
          <Text style={styles.shareName} numberOfLines={1}>{r.name}</Text>
          <Text style={styles.shareValue}>{r.share}%</Text>
        </View>
      ))}
      {extra && (
        <View style={styles.shareRow}>
          <View style={[styles.dot, styles.dotEmpty]} />
          <Text style={[styles.shareName, { color: c.mutedForeground }]}>{extra.name}</Text>
          <Text style={[styles.shareValue, { color: c.mutedForeground }]}>{extra.share}%</Text>
        </View>
      )}
    </View>
  );
}

export function InspectCard({ info, world, onClose, onPersonPress, onDynastyPress }: {
  info: PixelInfo | null;
  world: World;
  onClose: () => void;
  onPersonPress?: (id: number) => void;
  onDynastyPress?: (familyId: number) => void;
}) {
  const personLink = (person: { id: number; name: string; familyId: number; familyName: string }, detail: string) => (
    <View key={person.id} style={styles.personRow}>
      <Pressable onPress={() => onPersonPress?.(person.id)} disabled={!onPersonPress}>
        <Text style={[styles.countryLine, onPersonPress && styles.personLink]}>{person.name}</Text>
      </Pressable>
      <View style={styles.personDetails}>
        <Text style={styles.countryLine}>{detail} · </Text>
        <Pressable onPress={() => onDynastyPress?.(person.familyId)} disabled={!onDynastyPress} accessibilityRole="link">
          <Text style={[styles.countryLine, onDynastyPress && styles.personLink]}>{person.familyName}</Text>
        </Pressable>
      </View>
    </View>
  );
  return (
    <View style={styles.card} testID="panel-inspect">
      <Pressable onPress={onClose} style={styles.close} hitSlop={8} accessibilityLabel="Закрыть" testID="button-close-inspect">
        <Feather name="x" size={18} color={c.foreground} />
      </Pressable>
      <ScrollView contentContainerStyle={{ padding: 12 }}>
        {!info ? (
          <Text style={styles.muted}>За краем карты.</Text>
        ) : !info.land ? (
          <View>
            <Text style={styles.name}>Море</Text>
            <Text style={styles.coords}>x {info.x} · y {info.y}</Text>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <View style={{ paddingRight: 32 }}>
              <View style={styles.nameRow}>
                {info.country && <View style={[styles.swatch, { backgroundColor: info.country.color }]} />}
                <Text style={styles.name} testID="text-inspect-country">{info.country ? info.country.name : 'Ничья земля'}</Text>
              </View>
              <Text style={styles.muted}>
                {info.country ? `${info.country.rank} · ` : ''}
                {info.biome} · x {info.x}, y {info.y}
              </Text>
              {info.country && (
                <View style={styles.countryDetails}>
                  <Text style={styles.countryHeading}>ГОСУДАРСТВО</Text>
                  <Text style={styles.countryLine}>Площадь · {fmt(info.country.pixels)} земель</Text>
                  <Text style={styles.countryLine}>Население · {fmt(info.countryPopulation)} чел.</Text>
                  <Text style={styles.countryLine}>Форма · {GOVERNMENTS[governmentOf(info.country.government).id].name}</Text>
                  {info.country.modifiers.map((modifier) => (
                    <Text key={modifier} style={styles.modifier}>· {MODIFIERS[modifier].name}: {MODIFIERS[modifier].effect}</Text>
                  ))}
                  <Text style={styles.countryHeading}>ПРАВИТЕЛЬ</Text>
                  {personLink(info.country.ruler,
                    `${info.country.ruler.age} лет · ${ageStage(info.country.ruler.age)} · ${worldCultureName(world, info.country.ruler.cultureId)} · ${worldReligionName(world, info.country.ruler.religionId)}`)}
                  {info.country.heir && (
                    <>
                      <Text style={styles.countryHeading}>ОЖИДАЕМЫЙ НАСЛЕДНИК</Text>
                      {personLink(info.country.heir,
                        `${info.country.heir.age} лет · ${ageStage(info.country.heir.age)} · ${worldCultureName(world, info.country.heir.cultureId)} · ${worldReligionName(world, info.country.heir.religionId)}`)}
                    </>
                  )}
                  {info.country.coRulerIds.map((id) => {
                    const coRuler = info.family.find((p) => p.id === id);
                    return coRuler ? (
                      <View key={id}>
                        <Text style={styles.countryHeading}>СОПРАВИТЕЛЬ</Text>
                        {personLink(coRuler, `${coRuler.age} лет (${ageStage(coRuler.age)}) · ${worldCultureName(world, coRuler.cultureId)} · ${worldReligionName(world, coRuler.religionId)}`)}
                      </View>
                    ) : null;
                  })}
                  {info.family.length > 0 && (
                    <>
                      <Text style={styles.countryHeading}>ДИНАСТИЯ ПРАВИТЕЛЯ</Text>
                      {info.family.filter((member) => member.familyId === info.country!.ruler.familyId).map((member) => (
                        <View key={member.id}>
                          {personLink(member,
                            `${member.age} лет · ${ageStage(member.age)} · ${worldCultureName(world, member.cultureId)} · ${worldReligionName(world, member.religionId)}${member.alive ? '' : ` · умер${member.gender === 'female' ? 'ла' : ''} в ${member.deathYear ?? '?'}`}`)}
                        </View>
                      ))}
                    </>
                  )}
                </View>
              )}
            </View>
            <View style={{ gap: 4 }}>
              <Bar label="Влажность" value={info.humidity} />
              <Bar label="Температура" value={info.temperature} />
              <Bar label="Дренаж" value={info.drainage} />
              <Bar label="Население" value={Math.round((info.density / MAX_DENSITY) * 100)} />
              <Text style={styles.densityNote}>плотность {info.density} из {MAX_DENSITY}</Text>
            </View>
            {info.country ? (
              <>
                <Shares title="НАРОДЫ" rows={info.cultures} />
                <Shares title="ВЕРЫ" rows={info.religions} extra={{ name: 'Атеисты', share: info.nonBelievers }} />
              </>
            ) : (
              <Text style={[styles.muted, { fontStyle: 'italic' }]}>Здесь никто не живёт.</Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function worldCultureName(world: World, id: number): string {
  return world.cultures[id]?.name ?? `культура №${id + 1}`;
}
function worldReligionName(world: World, id: number | null): string {
  return id === null ? 'атеист' : world.religions[id]?.name ?? `вера №${id + 1}`;
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    maxHeight: '70%',
    maxWidth: 360,
    alignSelf: 'center',
    backgroundColor: c.card,
    borderWidth: 2,
    borderColor: c.foreground,
    borderRadius: 4,
    shadowColor: '#2c1e17',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  close: { position: 'absolute', right: 6, top: 6, zIndex: 2, width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 12, height: 12, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(44,30,23,0.5)' },
  name: { flexShrink: 1, fontFamily: fonts.display, fontSize: 18, lineHeight: 22, color: c.foreground },
  coords: { fontFamily: fonts.mono, fontSize: 11, color: c.mutedForeground },
  muted: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  barLabel: { width: 80, fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  barTrack: { flex: 1, height: 6, backgroundColor: c.muted, borderRadius: 1, overflow: 'hidden' },
  barFill: { height: '100%', backgroundColor: c.foreground, opacity: 0.8 },
  barValue: { width: 28, textAlign: 'right', fontFamily: fonts.mono, fontSize: 11, color: c.foreground },
  densityNote: { textAlign: 'right', fontFamily: fonts.sans, fontSize: 10, color: c.mutedForeground },
  countryDetails: { marginTop: 4, padding: 8, gap: 3, backgroundColor: c.muted, borderLeftWidth: 2, borderLeftColor: c.primary },
  countryHeading: { marginTop: 3, fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1, color: c.primary },
  countryLine: { fontFamily: fonts.sans, fontSize: 12, color: c.foreground },
  personRow: { paddingVertical: 2 },
  personDetails: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  personLink: { color: c.accent, textDecorationLine: 'underline' },
  modifier: { fontFamily: fonts.sans, fontSize: 11, color: c.mutedForeground },
  sharesTitle: { marginBottom: 4, fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1.6, color: c.mutedForeground },
  stack: { flexDirection: 'row', height: 8, backgroundColor: c.muted, borderRadius: 1, overflow: 'hidden', marginBottom: 4 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 1 },
  dot: { width: 10, height: 10, borderRadius: 1 },
  dotEmpty: { borderWidth: 1, borderColor: 'rgba(44,30,23,0.3)' },
  shareName: { flex: 1, fontFamily: fonts.sans, fontSize: 12, color: c.foreground },
  shareValue: { fontFamily: fonts.mono, fontSize: 12, color: c.foreground },
});
