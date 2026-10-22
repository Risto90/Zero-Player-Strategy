import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  advanceTurn,
  createGame,
  GameState,
  getCellColor,
  MAP_COLS,
  MAP_ROWS,
  MapKind,
  normalizeSavedGame,
  paintCell,
  PlayerRole,
  tickTimer,
  toggleBrushMode,
  togglePause,
} from '@/game/engine';

const SAVE_KEY = 'zero-strategy-save-v1';

const mapOptions: { id: MapKind; title: string; detail: string; icon: 'globe' | 'shuffle' }[] = [
  { id: 'world', title: 'Карта мира', detail: 'Континенты, климат и биомы', icon: 'globe' },
  { id: 'random', title: 'Новый мир', detail: 'Случайная география каждый раз', icon: 'shuffle' },
];

const roles: { id: PlayerRole; title: string; detail: string }[] = [
  { id: 'all', title: 'Все страны', detail: 'Карта мира и карта каждой страны' },
  { id: 'country', title: 'Фокус на стране', detail: 'Вы ведёте одно государство' },
  { id: 'world', title: 'Бог мира', detail: 'Только мировые карты' },
  { id: 'observer', title: 'Наблюдатель', detail: 'Мир развивается сам' },
];

function formatTime(seconds: number): string {
  return `00:${Math.max(0, seconds).toString().padStart(2, '0')}`;
}

function PrimaryButton({
  title,
  onPress,
  colors,
  icon,
}: {
  title: string;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  icon: keyof typeof Feather.glyphMap;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.primaryButton,
        { backgroundColor: colors.primary, opacity: pressed ? 0.84 : 1 },
      ]}
    >
      <Feather name={icon} size={17} color={colors.primaryForeground} />
      <Text style={[styles.primaryButtonText, { color: colors.primaryForeground }]}>{title}</Text>
    </Pressable>
  );
}

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [mapKind, setMapKind] = useState<MapKind>('world');
  const [role, setRole] = useState<PlayerRole>('country');
  const [game, setGame] = useState<GameState | null>(null);
  const [screen, setScreen] = useState<'home' | 'game'>('home');
  const [hydrated, setHydrated] = useState(false);
  const [hasSave, setHasSave] = useState(false);
  const mapSize = useRef({ width: 1, height: 1 });
  const gameRef = useRef<GameState | null>(null);
  const lastPaintedCellId = useRef<string | null>(null);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(SAVE_KEY)
      .then((saved) => {
        if (!active) return;
        if (saved) {
          const parsed = normalizeSavedGame(JSON.parse(saved) as GameState);
          setGame(parsed);
          setHasSave(true);
        }
      })
      .catch(() => {
        if (active) setHasSave(false);
      })
      .finally(() => {
        if (active) setHydrated(true);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    gameRef.current = game;
    if (!hydrated || !game) return;
    setHasSave(true);
    AsyncStorage.setItem(SAVE_KEY, JSON.stringify(game)).catch(() => {
      // The active session remains usable even if local storage is unavailable.
    });
  }, [game, hydrated]);

  useEffect(() => {
    if (screen !== 'game' || !game || game.paused) return;
    const timer = setInterval(() => {
      setGame((current) => (current ? tickTimer(current) : current));
    }, 1000);
    return () => clearInterval(timer);
  }, [screen, game?.paused, Boolean(game)]);

  const mapResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (event) => {
        lastPaintedCellId.current = null;
        paintAt(event.nativeEvent.locationX, event.nativeEvent.locationY);
      },
      onPanResponderMove: (event) => {
        paintAt(event.nativeEvent.locationX, event.nativeEvent.locationY);
      },
      onPanResponderRelease: () => {
        lastPaintedCellId.current = null;
      },
      onPanResponderTerminate: () => {
        lastPaintedCellId.current = null;
      },
      onPanResponderTerminationRequest: () => false,
    }),
  ).current;

  function paintAt(x: number, y: number) {
    const current = gameRef.current;
    const { width: mapWidth, height: mapHeight } = mapSize.current;
    if (!current || mapWidth <= 0 || mapHeight <= 0) return;
    if (x < 0 || y < 0 || x >= mapWidth || y >= mapHeight) return;
    const col = Math.floor((x / mapWidth) * MAP_COLS);
    const row = Math.floor((y / mapHeight) * MAP_ROWS);
    const target = current.cells.find((cell) => cell.row === row && cell.col === col);
    if (!target || target.id === lastPaintedCellId.current) return;
    lastPaintedCellId.current = target.id;
    setGame((previous) => (previous ? paintCell(previous, target.id) : previous));
  }

  const startGame = () => {
    const next = createGame(mapKind, role);
    setGame(next);
    setScreen('game');
  };

  const continueGame = () => {
    setScreen('game');
  };

  const leaveGame = () => {
    setScreen('home');
  };

  const endTurn = () => {
    setGame((previous) => (previous ? advanceTurn(previous) : previous));
  };

  const switchPause = () => {
    setGame((previous) => (previous ? togglePause(previous) : previous));
  };

  const switchBrush = () => {
    setGame((previous) => (previous ? toggleBrushMode(previous) : previous));
  };

  const countryById = useMemo(
    () => new Map((game?.countries ?? []).map((country) => [country.id, country])),
    [game?.countries],
  );

  if (screen === 'game' && game) {
    const landCount = game.cells.filter((cell) => cell.land).length;
    const ownedCount = game.cells.filter((cell) => cell.ownerId).length;
    const card = game.activeCard;
    const title = card?.title ?? (game.role === 'observer' ? 'Мир без игрока' : 'Ожидание события');
    const strokeMessage =
      card?.type === 'create'
        ? `Новая ${game.draftCountry?.rank.toLocaleLowerCase() ?? 'страна'} · ${game.draftCountry?.name ?? ''}`
        : game.draftCountry?.name ??
          (card?.targetCountryId ? countryById.get(card.targetCountryId)?.name : null);

    return (
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top + 6, paddingBottom: insets.bottom + 4 }]}>
        <StatusBar style="dark" />
        <View style={styles.gameHeader}>
          <Pressable onPress={leaveGame} accessibilityRole="button" accessibilityLabel="Вернуться в меню" style={styles.iconButton}>
            <Feather name="arrow-left" size={20} color={colors.foreground} />
          </Pressable>
          <View style={styles.headerTitleGroup}>
            <Text style={[styles.eyebrow, { color: colors.mutedForeground }]}>МИРОВАЯ ХРОНИКА</Text>
            <Text style={[styles.headerTitle, { color: colors.foreground }]}>{game.year} год</Text>
          </View>
          <View style={[styles.timerPill, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Feather name="clock" size={14} color={game.secondsLeft < 12 ? colors.destructive : colors.primary} />
            <Text style={[styles.timerText, { color: colors.foreground }]}>{formatTime(game.secondsLeft)}</Text>
          </View>
        </View>

        <View style={styles.statsRow}>
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{game.countries.length}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>государств</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{ownedCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>областей</Text>
          </View>
          <View style={[styles.statDivider, { backgroundColor: colors.border }]} />
          <View style={styles.statBox}>
            <Text style={[styles.statValue, { color: colors.foreground }]}>{landCount}</Text>
            <Text style={[styles.statLabel, { color: colors.mutedForeground }]}>суши</Text>
          </View>
          <View style={styles.turnTag}>
            <Text style={[styles.turnTagText, { color: colors.primary }]}>ХОД {game.turn}</Text>
          </View>
        </View>

        <View style={[styles.mapCard, { backgroundColor: colors.ocean, borderColor: colors.border }]}>
          <View style={styles.mapTopline}>
            <View>
              <Text style={[styles.mapTitle, { color: colors.foreground }]}>
                {game.mapKind === 'world' ? 'Карта мира' : 'Случайный мир'}
              </Text>
              <Text style={[styles.mapSubtitle, { color: colors.mutedForeground }]}>Влажность · биомы · границы</Text>
            </View>
            <View style={[styles.compass, { borderColor: colors.border }]}>
              <Feather name="navigation" size={15} color={colors.primary} />
            </View>
          </View>
          <View
            style={[styles.mapGrid, { backgroundColor: colors.ocean }]}
            onLayout={(event) => {
              mapSize.current = event.nativeEvent.layout;
            }}
            {...mapResponder.panHandlers}
            accessibilityLabel="Игровая карта. Проведите пальцем, чтобы рисовать территорию."
          >
            {Array.from({ length: MAP_ROWS }, (_, row) => (
              <View key={`row-${row}`} style={styles.mapRow} pointerEvents="none">
                {game.cells
                  .filter((cell) => cell.row === row)
                  .map((cell) => {
                    const owner = cell.ownerId ? countryById.get(cell.ownerId) : undefined;
                    const draftColor =
                      game.draftCountry?.id === cell.ownerId ? game.draftCountry.color : null;
                    const color = owner?.color ?? draftColor ?? getCellColor(cell);
                    return (
                      <View
                        key={cell.id}
                        style={[
                          styles.mapCell,
                          {
                            backgroundColor: cell.land ? color : colors.ocean,
                            opacity: cell.land && !cell.ownerId ? 0.94 : 1,
                          },
                        ]}
                      />
                    );
                  })}
              </View>
            ))}
          </View>
          <View style={styles.mapLegend}>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.biomePalette[1] }]} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>ничейная земля</Text>
            </View>
            <View style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: colors.countryPalette[0] }]} />
              <Text style={[styles.legendText, { color: colors.mutedForeground }]}>государство</Text>
            </View>
            <Text style={[styles.zoomNote, { color: colors.mutedForeground }]}>Проведите по карте</Text>
          </View>
        </View>

        <View style={[styles.cardPanel, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <View style={[styles.cardIcon, { backgroundColor: colors.accent }]}>
              <Feather
                name={card?.type === 'drought' ? 'sun' : card?.type === 'rain' ? 'cloud-rain' : 'map'}
                size={18}
                color={colors.primary}
              />
            </View>
            <View style={styles.cardHeading}>
              <Text style={[styles.cardKicker, { color: colors.primary }]}>
                {game.role === 'observer'
                  ? 'РЕЖИМ НАБЛЮДАТЕЛЯ'
                  : game.role === 'all'
                    ? 'КАРТА МИРА И ГОСУДАРСТВ'
                    : game.role === 'world'
                      ? 'МИРОВАЯ КАРТА'
                      : 'КАРТА СТРАНЫ'}
              </Text>
              <Text style={[styles.cardTitle, { color: colors.foreground }]}>{title}</Text>
            </View>
            {card ? (
              <View style={[styles.inkPill, { backgroundColor: colors.inkSurface }]}>
                <Feather name="edit-3" size={13} color={colors.ink} />
                <Text style={[styles.inkText, { color: colors.ink }]}>{card.ink}</Text>
              </View>
            ) : null}
          </View>
          <Text style={[styles.cardDetail, { color: colors.mutedForeground }]}>
            {strokeMessage ?? game.message}
          </Text>
          {game.draftCountry ? (
            <View style={styles.nationMeta}>
              <View style={[styles.nationSwatch, { backgroundColor: game.draftCountry.color }]} />
              <Text style={[styles.nationMetaText, { color: colors.foreground }]}>
                {game.draftCountry.culture} · {game.draftCountry.density} плотность
              </Text>
              <Text style={[styles.nationFaith, { color: colors.mutedForeground }]}>
                {game.draftCountry.religion}
              </Text>
            </View>
          ) : null}
          {(game.role === 'country' || game.role === 'all') &&
          card &&
          !['drought', 'rain'].includes(card.type) ? (
            <Pressable
              onPress={switchBrush}
              accessibilityRole="button"
              style={[styles.brushToggle, { borderColor: colors.border }]}
            >
              <Feather name={game.brushMode === 'density' ? 'plus-circle' : 'git-commit'} size={15} color={colors.primary} />
              <Text style={[styles.brushToggleText, { color: colors.foreground }]}>
                {game.brushMode === 'density' ? 'Плотность: включена' : 'Повторный мазок: без эффекта'}
              </Text>
              <Feather name="chevron-right" size={15} color={colors.mutedForeground} />
            </Pressable>
          ) : null}
          <Text style={[styles.feedbackText, { color: colors.mutedForeground }]}>{game.message}</Text>
        </View>

        <View style={styles.controlsRow}>
          <Pressable
            onPress={switchPause}
            accessibilityRole="button"
            style={[styles.secondaryButton, { borderColor: colors.border, backgroundColor: colors.card }]}
          >
            <Feather name={game.paused ? 'play' : 'pause'} size={16} color={colors.foreground} />
            <Text style={[styles.secondaryButtonText, { color: colors.foreground }]}>{game.paused ? 'Продолжить' : 'Пауза'}</Text>
          </Pressable>
          <Pressable
            onPress={endTurn}
            accessibilityRole="button"
            style={({ pressed }) => [
              styles.nextTurnButton,
              { backgroundColor: colors.foreground, opacity: pressed ? 0.82 : 1 },
            ]}
          >
            <Text style={[styles.nextTurnText, { color: colors.background }]}>
              {game.queuedCards.length > 0 ? 'Следующая карта' : 'Следующий год'}
            </Text>
            <Feather name="arrow-right" size={17} color={colors.background} />
          </Pressable>
        </View>
        {game.countries.length > 0 ? (
          <View style={styles.countryStrip}>
            {game.countries.slice(0, 4).map((country) => (
              <View key={country.id} style={styles.countryPill}>
                <View style={[styles.countryDot, { backgroundColor: country.color }]} />
                <Text numberOfLines={1} style={[styles.countryText, { color: colors.mutedForeground }]}>
                  {country.name}
                </Text>
              </View>
            ))}
          </View>
        ) : null}
        {game.eventLog[0] ? (
          <View style={[styles.eventSummary, { backgroundColor: colors.card }]}>
            <View style={[styles.eventMarker, { backgroundColor: colors.accent }]}>
              <Feather name="activity" size={12} color={colors.primary} />
            </View>
            <View style={styles.eventCopy}>
              <Text style={[styles.eventLabel, { color: colors.primary }]}>СОБЫТИЯ ПОСЛЕДНЕГО ГОДА</Text>
              <Text numberOfLines={2} style={[styles.eventText, { color: colors.foreground }]}>
                {game.eventLog[0]}
              </Text>
            </View>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <ScrollView
      style={[styles.homeRoot, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.homeContent,
        { paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24, minHeight: '100%' },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <StatusBar style="dark" />
      <View style={styles.brandRow}>
        <View style={[styles.brandMark, { backgroundColor: colors.primary }]}>
          <Feather name="map" size={19} color={colors.primaryForeground} />
        </View>
        <View>
          <Text style={[styles.brandName, { color: colors.foreground }]}>ZERO STRATEGY</Text>
          <Text style={[styles.brandCaption, { color: colors.mutedForeground }]}>МИР, КОТОРЫЙ ИГРАЕТ САМ</Text>
        </View>
        <View style={styles.versionTag}>
          <View style={[styles.liveDot, { backgroundColor: colors.success }]} />
          <Text style={[styles.versionText, { color: colors.mutedForeground }]}>ПЕРВАЯ ЭРА</Text>
        </View>
      </View>

      <View style={styles.hero}>
        <Text style={[styles.heroKicker, { color: colors.primary }]}>СТРАТЕГИЯ БЕЗ ХОДОВ ПРОТИВНИКА</Text>
        <Text style={[styles.heroTitle, { color: colors.foreground }]}>
          Нарисуйте мир.{'\n'}Понаблюдайте, что будет.
        </Text>
        <Text style={[styles.heroBody, { color: colors.mutedForeground }]}>
          Проведите границы первых государств, а затем смотрите, как культура, климат и случай решают их судьбу.
        </Text>
      </View>

      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Выберите мир</Text>
        <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>01 / 02</Text>
      </View>
      <View style={styles.optionRow}>
        {mapOptions.map((option) => {
          const selected = option.id === mapKind;
          return (
            <Pressable
              key={option.id}
              onPress={() => setMapKind(option.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.optionCard,
                {
                  backgroundColor: selected ? colors.cardSelected : colors.card,
                  borderColor: selected ? colors.primary : colors.border,
                },
              ]}
            >
              <View style={[styles.optionIcon, { backgroundColor: selected ? colors.primary : colors.secondary }]}>
                <Feather name={option.icon} size={18} color={selected ? colors.primaryForeground : colors.mutedForeground} />
              </View>
              <Text style={[styles.optionTitle, { color: colors.foreground }]}>{option.title}</Text>
              <Text style={[styles.optionDetail, { color: colors.mutedForeground }]}>{option.detail}</Text>
              {selected ? <View style={[styles.selectedMark, { backgroundColor: colors.primary }]}><Feather name="check" size={12} color={colors.primaryForeground} /></View> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: colors.foreground }]}>Ваша роль</Text>
        <Text style={[styles.sectionHint, { color: colors.mutedForeground }]}>02 / 02</Text>
      </View>
      <View style={[styles.roleList, { borderColor: colors.border, backgroundColor: colors.card }]}>
        {roles.map((item, index) => {
          const selected = role === item.id;
          return (
            <Pressable
              key={item.id}
              onPress={() => setRole(item.id)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[
                styles.roleOption,
                index < roles.length - 1 ? { borderBottomColor: colors.border, borderBottomWidth: StyleSheet.hairlineWidth } : null,
              ]}
            >
              <View style={[styles.radioRing, { borderColor: selected ? colors.primary : colors.border }]}>
                {selected ? <View style={[styles.radioDot, { backgroundColor: colors.primary }]} /> : null}
              </View>
              <View style={styles.roleCopy}>
                <Text style={[styles.roleTitle, { color: colors.foreground }]}>{item.title}</Text>
                <Text style={[styles.roleDetail, { color: colors.mutedForeground }]}>{item.detail}</Text>
              </View>
              {selected ? <Feather name="arrow-up-right" size={17} color={colors.primary} /> : null}
            </Pressable>
          );
        })}
      </View>

      <View style={styles.homeActions}>
        <PrimaryButton title="Создать мир" onPress={startGame} colors={colors} icon="arrow-up-right" />
        {hydrated && hasSave ? (
          <Pressable onPress={continueGame} style={styles.continueButton} accessibilityRole="button">
            <Feather name="rotate-ccw" size={15} color={colors.primary} />
            <Text style={[styles.continueText, { color: colors.primary }]}>Продолжить сохранённый мир</Text>
          </Pressable>
        ) : null}
      </View>

      <View style={[styles.footerNote, { borderTopColor: colors.border }]}>
        <Feather name="save" size={14} color={colors.mutedForeground} />
        <Text style={[styles.footerText, { color: colors.mutedForeground }]}>
          Партия сохраняется автоматически на этом устройстве.
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 18 },
  homeRoot: { flex: 1 },
  homeContent: { paddingHorizontal: 20 },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 13, letterSpacing: 1.35, fontWeight: '700' },
  brandCaption: { fontSize: 8, letterSpacing: 1.3, marginTop: 3, fontWeight: '600' },
  versionTag: { marginLeft: 'auto', flexDirection: 'row', alignItems: 'center', gap: 6 },
  liveDot: { width: 6, height: 6, borderRadius: 4 },
  versionText: { fontSize: 8, letterSpacing: 1, fontWeight: '600' },
  hero: { paddingTop: 40, paddingBottom: 25 },
  heroKicker: { fontSize: 9, letterSpacing: 1.5, fontWeight: '700' },
  heroTitle: { fontSize: 34, lineHeight: 39, letterSpacing: -1.2, fontWeight: '700', marginTop: 11 },
  heroBody: { fontSize: 14, lineHeight: 21, marginTop: 12, maxWidth: 340 },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, marginTop: 5 },
  sectionTitle: { fontSize: 16, fontWeight: '700' },
  sectionHint: { fontSize: 9, letterSpacing: 1, fontWeight: '600' },
  optionRow: { flexDirection: 'row', gap: 10, marginBottom: 22 },
  optionCard: { flex: 1, minHeight: 126, borderWidth: 1, borderRadius: 16, padding: 13, position: 'relative' },
  optionIcon: { width: 32, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  optionTitle: { fontSize: 13, fontWeight: '700' },
  optionDetail: { fontSize: 10, lineHeight: 14, marginTop: 4, paddingRight: 3 },
  selectedMark: { width: 19, height: 19, borderRadius: 10, position: 'absolute', top: 10, right: 10, alignItems: 'center', justifyContent: 'center' },
  roleList: { borderWidth: 1, borderRadius: 16, overflow: 'hidden' },
  roleOption: { minHeight: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 12 },
  radioRing: { width: 17, height: 17, borderWidth: 1.5, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 8, height: 8, borderRadius: 5 },
  roleCopy: { flex: 1 },
  roleTitle: { fontSize: 12, fontWeight: '700' },
  roleDetail: { fontSize: 10, marginTop: 2 },
  homeActions: { marginTop: 22, gap: 12 },
  primaryButton: { minHeight: 52, paddingHorizontal: 17, borderRadius: 15, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 9 },
  primaryButtonText: { fontSize: 14, fontWeight: '700', letterSpacing: 0.2 },
  continueButton: { alignSelf: 'center', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12 },
  continueText: { fontSize: 12, fontWeight: '600' },
  footerNote: { marginTop: 20, paddingTop: 14, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8 },
  footerText: { fontSize: 10 },
  gameHeader: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitleGroup: { flex: 1 },
  eyebrow: { fontSize: 8, letterSpacing: 1.2, fontWeight: '700' },
  headerTitle: { fontSize: 17, fontWeight: '700', marginTop: 2 },
  timerPill: { borderWidth: 1, borderRadius: 12, minWidth: 78, paddingHorizontal: 10, height: 34, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  timerText: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },
  statsRow: { height: 57, flexDirection: 'row', alignItems: 'center', marginBottom: 9 },
  statBox: { minWidth: 63, alignItems: 'center' },
  statValue: { fontSize: 15, fontWeight: '700' },
  statLabel: { fontSize: 8, marginTop: 2 },
  statDivider: { width: StyleSheet.hairlineWidth, height: 26 },
  turnTag: { marginLeft: 'auto', borderRadius: 7, paddingHorizontal: 9, paddingVertical: 6 },
  turnTagText: { fontSize: 9, fontWeight: '700', letterSpacing: 1 },
  mapCard: { borderWidth: 1, borderRadius: 19, padding: 13, overflow: 'hidden' },
  mapTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2, marginBottom: 11 },
  mapTitle: { fontSize: 14, fontWeight: '700' },
  mapSubtitle: { fontSize: 9, marginTop: 3 },
  compass: { width: 29, height: 29, borderRadius: 9, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  mapGrid: { width: '100%', aspectRatio: 20 / 11, overflow: 'hidden', borderRadius: 9 },
  mapRow: { flex: 1, flexDirection: 'row', gap: 1, marginBottom: 1 },
  mapCell: { flex: 1, borderRadius: 1 },
  mapLegend: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10, paddingHorizontal: 2 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 7, height: 7, borderRadius: 2 },
  legendText: { fontSize: 8 },
  zoomNote: { fontSize: 8, marginLeft: 'auto' },
  cardPanel: { marginTop: 10, borderWidth: 1, borderRadius: 16, paddingHorizontal: 13, paddingTop: 12, paddingBottom: 9 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  cardHeading: { flex: 1 },
  cardKicker: { fontSize: 8, letterSpacing: 1.1, fontWeight: '700' },
  cardTitle: { fontSize: 13, fontWeight: '700', marginTop: 2 },
  inkPill: { minWidth: 43, height: 29, borderRadius: 9, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 5 },
  inkText: { fontSize: 11, fontWeight: '700' },
  cardDetail: { fontSize: 10, lineHeight: 14, marginTop: 8 },
  nationMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 9 },
  nationSwatch: { width: 8, height: 8, borderRadius: 3 },
  nationMetaText: { fontSize: 9, fontWeight: '600' },
  nationFaith: { fontSize: 9, marginLeft: 'auto' },
  brushToggle: { borderWidth: 1, borderRadius: 9, minHeight: 33, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 9, marginTop: 8 },
  brushToggleText: { flex: 1, fontSize: 9, fontWeight: '600' },
  feedbackText: { fontSize: 9, lineHeight: 13, marginTop: 8 },
  controlsRow: { flexDirection: 'row', gap: 9, marginTop: 10 },
  secondaryButton: { flex: 0.85, minHeight: 45, borderWidth: 1, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  secondaryButtonText: { fontSize: 11, fontWeight: '600' },
  nextTurnButton: { flex: 1.25, minHeight: 45, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  nextTurnText: { fontSize: 11, fontWeight: '700' },
  countryStrip: { flexDirection: 'row', alignItems: 'center', marginTop: 10, gap: 10, minHeight: 19 },
  countryPill: { flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 80 },
  countryDot: { width: 6, height: 6, borderRadius: 2 },
  countryText: { fontSize: 8, flexShrink: 1 },
  eventSummary: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 11, paddingHorizontal: 9, paddingVertical: 7, marginTop: 8 },
  eventMarker: { width: 25, height: 25, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  eventCopy: { flex: 1 },
  eventLabel: { fontSize: 7, letterSpacing: 0.9, fontWeight: '700' },
  eventText: { fontSize: 9, lineHeight: 12, marginTop: 2 },
});
