import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';
import { fmt } from '@/game/format';
import type { Game, GameSnapshot } from '@/game/game';

const c = colors.light;

const ROLE_LABEL: Record<string, string> = {
  all: 'ВЕСЬ МИР',
  country: 'ОДНА СТРАНА',
  world: 'МИРОВЫЕ СОБЫТИЯ',
  observer: 'НАБЛЮДАТЕЛЬ',
};

export function CardPanel({ game, snap }: { game: Game; snap: GameSnapshot }) {
  const card = snap.card;
  const inkShare = card && card.inkTotal > 0 ? card.ink / card.inkTotal : 0;
  const nextLabel = card
    ? snap.queuedCards > 0
      ? 'Готово'
      : card.type === 'government'
        ? 'Принять реформу'
        : card.type === 'succession'
          ? 'Передать власть'
          : card.type === 'election'
            ? 'Провести выборы'
            : card.type === 'death'
              ? 'Продолжить'
              : card.type === 'marriage' || card.type === 'birth' || card.type === 'character'
                ? 'Далее'
            : 'Следующий год'
    : 'Следующий год';
  const message = snap.message && snap.message !== card?.detail ? snap.message : '';
  const hot = !snap.drawing && (snap.paused || snap.secondsLeft <= 10);
  return (
    <View style={styles.panel} testID="panel-card">
      <View style={styles.top}>
        <Text style={styles.year} testID="text-year">{snap.year}</Text>
        <Text style={styles.small}>ГОД</Text>
        <Text style={[styles.small, { flexShrink: 1 }]} numberOfLines={1}>{ROLE_LABEL[snap.role]}</Text>
        <View style={styles.actions}>
          <Text style={[styles.timer, hot && { color: c.primary, borderColor: c.primary }]} testID="text-timer">
            {snap.drawing ? 'карта…' : `${String(Math.max(0, snap.secondsLeft)).padStart(2, '0')}с`}
          </Text>
          <Pressable onPress={() => game.togglePause()} style={styles.iconButton} hitSlop={4} testID="button-pause" accessibilityLabel={snap.paused ? 'Продолжить' : 'Пауза'}>
            <Feather name={snap.paused ? 'play' : 'pause'} size={16} color={c.foreground} />
          </Pressable>
          <Pressable
            onPress={() => void game.nextTurn()}
            disabled={snap.busy}
            style={({ pressed }) => [styles.next, (snap.busy || pressed) && { opacity: 0.6 }]}
            testID="button-next"
          >
            <Text style={styles.nextText}>{nextLabel}</Text>
            <Feather name="skip-forward" size={15} color={c.primaryForeground} />
          </Pressable>
        </View>
      </View>

      {snap.progress ? (
        <View style={styles.block}>
          <Text style={styles.title}>Мир делает ход…</Text>
          <View style={styles.inkRow}>
            <View style={styles.inkTrack}>
              <View style={[styles.inkFill, { width: `${snap.progress.total ? (snap.progress.done / snap.progress.total) * 100 : 100}%` }]} />
            </View>
            <Text style={styles.inkText} testID="text-progress">
              {snap.progress.done} / {snap.progress.total}
            </Text>
          </View>
        </View>
      ) : card ? (
        <View style={styles.block}>
          <View style={styles.titleRow}>
            {snap.cardCountry && <View style={[styles.swatch, { backgroundColor: snap.cardCountry.color }]} />}
            <Text style={styles.title} numberOfLines={1} testID="text-card-title">{card.title}</Text>
            {snap.queuedCards > 0 && (
              <Text style={styles.queued} testID="text-queued">ЕЩЁ {snap.queuedCards}</Text>
            )}
          </View>
          {snap.cardCountry && (
            <Text style={styles.country} testID="text-card-country">{snap.cardCountry.rank} {snap.cardCountry.name}</Text>
          )}
          <Text style={styles.detail} testID="text-card-detail">{card.detail}</Text>
          {card.characterEvent?.personIds.length ? (
            <View style={styles.subjects}>
              <Text style={styles.choiceDetail}>Персонажи:</Text>
              {card.characterEvent.personIds.map((id) => {
                const person = game.world.people.find((item) => item.id === id);
                return person ? (
                  <Pressable key={id} onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(id) } })}
                    testID={`link-card-person-${id}`}>
                    <Text style={[styles.choiceDetail, styles.personLink]}>{person.name}</Text>
                  </Pressable>
                ) : null;
              })}
            </View>
          ) : null}
          {card.choices && (
            <View style={styles.choices}>
              {card.choices.map((choice, index) => (
                (() => {
                  const candidate = choice.person ?? choice.ruler;
                  const style = [styles.choice, card.selectedChoice === index && styles.choiceSelected];
                  if (!candidate) {
                    return (
                      <Pressable key={`${choice.label}-${index}`} onPress={() => game.selectChoice(index)}
                        style={style} testID={`button-choice-${index}`} accessibilityRole="button"
                        accessibilityState={{ selected: card.selectedChoice === index }}>
                        <Text style={styles.choiceTitle}>{choice.label}</Text>
                        <Text style={styles.choiceDetail}>{choice.detail}</Text>
                      </Pressable>
                    );
                  }
                  return (
                    <View key={`${choice.label}-${index}`} style={style}>
                      <Pressable onPress={() => router.push({ pathname: '/person/[id]', params: { id: String(candidate.id) } })}
                        accessibilityRole="link" testID={`link-choice-person-${index}`}>
                        <Text style={[styles.choiceTitle, styles.personLink]}>{choice.label}</Text>
                      </Pressable>
                      <Text style={styles.choiceDetail}>{choice.detail}</Text>
                      <Pressable onPress={() => game.selectChoice(index)} style={styles.pickChoice}
                        testID={`button-choice-${index}`} accessibilityRole="button"
                        accessibilityState={{ selected: card.selectedChoice === index }}>
                        <Text style={styles.pickChoiceText}>{card.selectedChoice === index ? 'Выбрано' : 'Выбрать'}</Text>
                      </Pressable>
                    </View>
                  );
                })()
              ))}
            </View>
          )}
          {card.inkTotal > 0 && (
            <View style={styles.inkRow}>
              <View style={styles.inkTrack}>
                <View style={[styles.inkFill, { width: `${inkShare * 100}%` }]} />
              </View>
              <Text style={styles.inkText} testID="text-ink">{fmt(card.ink)} / {fmt(card.inkTotal)}</Text>
            </View>
          )}
        </View>
      ) : (
        <Text style={styles.empty}>Карт нет. Мир идёт своим чередом.</Text>
      )}
      {message !== '' && !snap.progress && (
        <Text style={styles.message} numberOfLines={3} testID="text-message">{message}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: c.card, borderBottomWidth: 2, borderBottomColor: c.foreground, paddingHorizontal: 12, paddingTop: 8, paddingBottom: 10 },
  top: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  year: { fontFamily: fonts.display, fontSize: 24, lineHeight: 28, color: c.foreground },
  small: { fontFamily: fonts.sansMedium, fontSize: 10, letterSpacing: 1, color: c.mutedForeground },
  actions: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  timer: { fontFamily: fonts.mono, fontSize: 13, color: c.foreground, borderWidth: 1, borderColor: c.border, borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.background },
  next: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: c.primary, borderRadius: 4, paddingHorizontal: 10 },
  nextText: { fontFamily: fonts.sansSemiBold, fontSize: 13, color: c.primaryForeground },
  block: { marginTop: 8 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  swatch: { width: 12, height: 12, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(44,30,23,0.5)' },
  title: { flexShrink: 1, fontFamily: fonts.display, fontSize: 18, lineHeight: 22, color: c.foreground },
  queued: { marginLeft: 'auto', fontFamily: fonts.sansSemiBold, fontSize: 10, letterSpacing: 1, color: c.secondaryForeground, backgroundColor: c.secondary, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2, overflow: 'hidden' },
  country: { fontFamily: fonts.sans, fontSize: 12, color: c.mutedForeground },
  detail: { marginTop: 4, fontFamily: fonts.sans, fontSize: 13, lineHeight: 17, color: c.foreground, opacity: 0.82 },
  subjects: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 6 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  choice: { flexGrow: 1, flexBasis: 140, borderWidth: 1, borderColor: c.border, borderRadius: 4, padding: 7, backgroundColor: c.background },
  choiceSelected: { borderColor: c.primary, borderWidth: 2, backgroundColor: c.secondary },
  choiceTitle: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.foreground },
  choiceDetail: { marginTop: 2, fontFamily: fonts.sans, fontSize: 11, lineHeight: 14, color: c.mutedForeground },
  personLink: { color: c.accent, textDecorationLine: 'underline' },
  pickChoice: { alignSelf: 'flex-start', marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 3, backgroundColor: c.secondary },
  pickChoiceText: { fontFamily: fonts.sansSemiBold, fontSize: 10, color: c.secondaryForeground },
  inkRow: { marginTop: 6, flexDirection: 'row', alignItems: 'center', gap: 8 },
  inkTrack: { flex: 1, height: 8, borderRadius: 2, borderWidth: 1, borderColor: 'rgba(44,30,23,0.4)', backgroundColor: c.muted, overflow: 'hidden' },
  inkFill: { height: '100%', backgroundColor: c.foreground },
  inkText: { fontFamily: fonts.mono, fontSize: 11, color: c.foreground },
  empty: { marginTop: 6, fontFamily: fonts.displayItalic, fontSize: 13, color: c.mutedForeground },
  message: { marginTop: 6, borderLeftWidth: 2, borderLeftColor: c.primary, paddingLeft: 8, fontFamily: fonts.sans, fontSize: 12.5, lineHeight: 17, color: c.primary },
});
