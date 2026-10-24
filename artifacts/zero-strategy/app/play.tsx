import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Platform, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardPanel } from '@/components/game/CardPanel';
import { InspectCard } from '@/components/game/InspectCard';
import { LegendPanel } from '@/components/game/LegendPanel';
import { LogPanel } from '@/components/game/LogPanel';
import { MapControls } from '@/components/game/MapControls';
import { MapLegend } from '@/components/game/MapLegend';
import { ModeTabs } from '@/components/game/ModeTabs';
import { Loading } from '@/components/Loading';
import { MapView } from '@/components/map/MapView';
import type { MapTool, MapViewHandle } from '@/components/map/types';
import colors, { fonts } from '@/constants/colors';
import { chronicleObjectOptions } from '@/game/chronicle';
import { MAP_WIDTH } from '@/game/config';
import { hasPlayerActionCard, type Game, type PixelInfo } from '@/game/game';
import { continueSavedGame, currentGame, leaveGame } from '@/game/session';
import { cityProfileRoute, countryProfileRoute } from '@/game/profileRoutes';
import type { MapMode } from '@/game/render';
import { useGameSnapshot } from '@/game/useGame';

const c = colors.light;

function goHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

export default function PlayScreen() {
  const [game, setGame] = useState<Game | null>(() => currentGame());
  const [failed, setFailed] = useState('');

  useEffect(() => {
    let alive = true;
    if (!game) {
      continueSavedGame()
        .then((loaded) => {
          if (!alive) return;
          if (loaded) setGame(loaded);
          else router.replace('/');
        })
        .catch((error: Error) => alive && setFailed(error.message));
    }
    return () => {
      alive = false;
    };
  }, [game]);

  useEffect(() => () => void leaveGame(), []);

  useEffect(() => {
    if (!game) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'background' || state === 'inactive') void game.saveNow();
    });
    return () => sub.remove();
  }, [game]);

  if (failed) return <Loading text={`Не удалось открыть сохранение: ${failed}`} />;
  if (!game) return <Loading text="Открываем атлас…" />;
  return <GameScreen game={game} />;
}

function GameScreen({ game }: { game: Game }) {
  const snap = useGameSnapshot(game);
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const mapRef = useRef<MapViewHandle>(null);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLogLine = useRef<string | undefined>(undefined);
  const [tool, setTool] = useState<MapTool>('hand');
  const [inspect, setInspect] = useState<{ info: PixelInfo | null } | null>(null);
  const [listMode, setListMode] = useState<MapMode | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logPreview, setLogPreview] = useState(false);
  const [zoomVisible, setZoomVisible] = useState(false);

  const canBrush = snap.canPaint && !snap.busy;
  const canPlaceCity = snap.cityPlacementAvailable && !snap.busy;
  const showTools = 1 + Number(canBrush) + Number(canPlaceCity) >= 2;
  const webTopInset = Platform.OS === 'web' ? Math.max(insets.top, 67) : insets.top;
  const webBottomInset = Platform.OS === 'web' ? Math.max(insets.bottom, 34) : insets.bottom;
  const mapHeight = Math.max(160, height - webTopInset - webBottomInset - 90);
  const overlayHeight = Math.max(140, Math.min(620, mapHeight - 56));
  const logHeight = Math.max(140, Math.min(420, mapHeight * 0.47));
  const historyObjectOptions = useMemo(
    () => chronicleObjectOptions(game.world),
    [game, game.world.version],
  );

  const onCityPress = useCallback((pixel: number) => {
    const x = pixel % MAP_WIDTH;
    const y = Math.floor(pixel / MAP_WIDTH);
    mapRef.current?.centerAtPixel(pixel);
    setTool('hand');
    setInspect({ info: game.inspect(x, y) });
  }, [game]);

  const changeTool = useCallback((nextTool: MapTool) => {
    setTool(nextTool);
    if (nextTool !== 'hand') setInspect(null);
  }, []);

  useEffect(() => {
    if (!canBrush && tool === 'brush') setTool('hand');
    if (!canPlaceCity && tool === 'city') setTool('hand');
  }, [canBrush, canPlaceCity, tool]);

  useEffect(() => {
    setListMode(null);
  }, [snap.mapMode]);

  useEffect(() => {
    if (!snap.card && !snap.progress) setCardOpen(false);
  }, [snap.card, snap.progress]);

  const showZoomForAWhile = useCallback(() => {
    setZoomVisible(true);
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
    zoomTimer.current = setTimeout(() => {
      setZoomVisible(false);
      zoomTimer.current = null;
    }, 3000);
  }, []);

  useEffect(() => () => {
    if (zoomTimer.current) clearTimeout(zoomTimer.current);
    if (previewTimer.current) clearTimeout(previewTimer.current);
  }, []);

  useEffect(() => {
    const newest = snap.log[0];
    if (newest === lastLogLine.current) return;
    lastLogLine.current = newest;
    if (!newest) return;
    setLogPreview(true);
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(() => {
      setLogPreview(false);
      previewTimer.current = null;
    }, 3000);
  }, [snap.log]);

  const log = useMemo(() => (
    <LogPanel log={snap.chronicle} transparent objectOptions={historyObjectOptions} />
  ), [historyObjectOptions, snap.chronicle]);
  const canOpenEvent = hasPlayerActionCard(snap);
  const nextLabel = snap.queuedCards > 0
    ? 'Готово'
    : snap.card?.type === 'government'
      ? 'Принять реформу'
      : snap.card?.type === 'succession'
        ? 'Передать власть'
        : snap.card?.type === 'election'
          ? 'Провести выборы'
          : snap.card?.type === 'death'
            ? 'Продолжить'
            : snap.card?.type === 'marriage' || snap.card?.type === 'birth' || snap.card?.type === 'character'
              ? 'Далее'
              : 'Следующий год';
  const latestText = snap.log[0]?.replace(/^\d+:\s*/, '') ?? '';
  const listTitle = listMode === 'cities' ? 'Города' : 'Список объектов';
  const selectedInfo = inspect?.info ? game.inspect(inspect.info.x, inspect.info.y) : null;

  return (
    <View style={[styles.screen, { paddingTop: webTopInset, paddingBottom: webBottomInset }]}>
      <View style={styles.topBar}>
        <Pressable onPress={goHome} style={styles.homeButton} hitSlop={8} testID="link-home" accessibilityLabel="Меню">
          <Feather name="chevron-left" size={17} color={c.secondaryForeground} />
          <Text style={styles.homeText}>Меню</Text>
        </Pressable>
        <ModeTabs game={game} snap={snap} />
        <View style={styles.yearBlock}>
          <Text style={styles.year}>{snap.year}</Text>
          <Text style={styles.yearCaption}>ГОД</Text>
        </View>
        <Text style={styles.brand} numberOfLines={1}>Zero Strategy</Text>
        <View style={styles.actions}>
          <Text style={[styles.timer, (!snap.drawing && (snap.paused || snap.secondsLeft <= 10)) && styles.timerHot]} testID="text-timer">
            {snap.drawing ? '…' : `${String(Math.max(0, snap.secondsLeft)).padStart(2, '0')}с`}
          </Text>
          <Pressable
            onPress={() => game.togglePause()}
            style={styles.iconButton}
            hitSlop={4}
            testID="button-pause"
            accessibilityLabel={snap.paused ? 'Продолжить' : 'Пауза'}
          >
            <Feather name={snap.paused ? 'play' : 'pause'} size={16} color={c.foreground} />
          </Pressable>
          <Pressable
            onPress={() => void game.nextTurn()}
            disabled={snap.busy}
            style={({ pressed }) => [styles.next, (snap.busy || pressed) && styles.disabled]}
            testID="button-next"
            accessibilityLabel={nextLabel}
          >
            <Feather name="skip-forward" size={15} color={c.primaryForeground} />
          </Pressable>
        </View>
      </View>

      <View style={styles.mapArea}>
        <MapView
          ref={mapRef}
          game={game}
          tool={tool}
          canPaint={canBrush}
          onInspect={(info) => setInspect({ info })}
          onMapActivity={showZoomForAWhile}
        />
        <MapControls
          game={game}
          snap={snap}
          tool={tool}
          setTool={changeTool}
          showTools={showTools}
          showBrush={canBrush}
          showCity={canPlaceCity}
          showZoom={zoomVisible}
          onZoom={(factor) => {
            showZoomForAWhile();
            mapRef.current?.zoomBy(factor);
          }}
          onFit={() => {
            showZoomForAWhile();
            mapRef.current?.fit();
          }}
        />

        {canOpenEvent && (
          <Pressable
            onPress={() => setCardOpen((open) => {
              const next = !open;
              if (next) {
                setListMode(null);
                setLogOpen(false);
              }
              return next;
            })}
            style={styles.eventBadge}
            testID="button-event-card"
            accessibilityRole="button"
            accessibilityState={{ expanded: cardOpen }}
          >
            <Feather name="book-open" size={14} color={c.primaryForeground} />
            <Text style={styles.eventBadgeText} numberOfLines={1}>{snap.progress ? 'Ход мира' : snap.card?.title ?? 'Событие'}</Text>
            {snap.queuedCards > 0 && <Text style={styles.queueCount}>+{snap.queuedCards}</Text>}
          </Pressable>
        )}

        <Pressable
          onPress={() => setListMode((mode) => {
            if (mode) return null;
            setCardOpen(false);
            setLogOpen(false);
            return snap.mapMode;
          })}
          style={styles.listButton}
          testID="button-open-map-list"
          accessibilityRole="button"
          accessibilityLabel="Открыть список объектов"
        >
          <Feather name="list" size={15} color={c.foreground} />
          <Text style={styles.listButtonText}>Список</Text>
        </Pressable>

        {tool === 'hand' && inspect && (
          <InspectCard
            info={selectedInfo}
            onClose={() => setInspect(null)}
            onCountryPress={(id) => router.push(countryProfileRoute(id))}
            onCityPress={(id) => router.push(cityProfileRoute(id))}
          />
        )}
        {tool === 'hand' && !inspect && (
          <View style={styles.tapHint} pointerEvents="none">
            <Text style={styles.tapHintText}>Коснитесь точки, чтобы её изучить</Text>
          </View>
        )}

        <View style={styles.chronicleDock}>
          {logPreview && !logOpen && !!latestText && (
            <Pressable style={styles.latestEntry} onPress={() => {
              setCardOpen(false);
              setListMode(null);
              setLogOpen(true);
            }} testID="text-latest-log" accessibilityLabel="Последняя запись летописи">
              <Text style={styles.latestText} numberOfLines={1}>{latestText}</Text>
            </Pressable>
          )}
          <Pressable
            onPress={() => setLogOpen((open) => {
              const next = !open;
              if (next) {
                setCardOpen(false);
                setListMode(null);
              }
              return next;
            })}
            style={[styles.chatButton, logOpen && styles.chatButtonOpen]}
            testID="button-toggle-log"
            accessibilityLabel={logOpen ? 'Закрыть летопись' : 'Открыть летопись'}
            accessibilityState={{ expanded: logOpen }}
          >
            <Feather name={logOpen ? 'x' : 'message-circle'} size={17} color={logOpen ? c.primaryForeground : c.foreground} />
          </Pressable>
        </View>

        {cardOpen && canOpenEvent && (
          <View style={[styles.overlayPanel, styles.cardOverlay, { height: overlayHeight }]}>
            <View style={styles.overlayHeader}>
              <Text style={styles.overlayTitle} numberOfLines={1}>{snap.progress ? 'Ход мира' : snap.card?.title ?? 'Событие'}</Text>
              <Pressable onPress={() => setCardOpen(false)} style={styles.closeButton} hitSlop={8} testID="button-close-event">
                <Feather name="x" size={18} color={c.foreground} />
              </Pressable>
            </View>
            <ScrollView style={styles.overlayScroll} contentContainerStyle={styles.overlayScrollContent} nestedScrollEnabled>
              <CardPanel game={game} snap={snap} />
            </ScrollView>
          </View>
        )}

        {listMode && (
          <View style={[styles.overlayPanel, styles.listOverlay, { height: overlayHeight }]} testID="overlay-map-list">
            <View style={styles.overlayHeader}>
              <Text style={styles.overlayTitle}>{listMode === 'cities' ? 'Города' : listTitle}</Text>
              <Pressable onPress={() => setListMode(null)} style={styles.closeButton} hitSlop={8} testID="button-close-map-list">
                <Feather name="x" size={18} color={c.foreground} />
              </Pressable>
            </View>
            <View style={styles.overlayBody}>
              <LegendPanel
                game={game}
                snap={snap}
                mode={listMode}
                onCityPress={(pixel) => {
                  setListMode(null);
                  onCityPress(pixel);
                }}
              />
            </View>
          </View>
        )}

        {logOpen && (
          <View style={[styles.overlayPanel, styles.logOverlay, { height: logHeight }]} testID="overlay-chronicle">
            <View style={styles.overlayHeader}>
              <Text style={styles.overlayTitle}>Летопись</Text>
              <Pressable onPress={() => setLogOpen(false)} style={styles.closeButton} hitSlop={8} testID="button-close-log">
                <Feather name="x" size={18} color={c.secondaryForeground} />
              </Pressable>
            </View>
            <View style={{ flex: 1 }}>{log}</View>
          </View>
        )}
      </View>

      <View style={styles.mapFooter}>
        <MapLegend game={game} snap={snap} />
        {snap.mapMode === 'political' && (
          <Pressable
            onPress={() => {
              setCardOpen(false);
              setLogOpen(false);
              setListMode('cities');
            }}
            style={styles.cityListButton}
            testID="button-open-cities"
            accessibilityRole="button"
          >
            <Feather name="home" size={14} color={c.secondaryForeground} />
            <Text style={styles.cityListText}>Города</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  topBar: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, backgroundColor: c.secondary, zIndex: 20 },
  homeButton: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 3 },
  homeText: { fontFamily: fonts.sans, fontSize: 11, color: c.secondaryForeground },
  yearBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 3, paddingHorizontal: 4 },
  year: { fontFamily: fonts.display, fontSize: 18, color: c.secondaryForeground },
  yearCaption: { fontFamily: fonts.sansMedium, fontSize: 8, letterSpacing: 0.6, color: c.secondaryForeground, opacity: 0.65 },
  brand: { flex: 1, minWidth: 42, marginLeft: 2, fontFamily: fonts.displayItalic, fontSize: 12, color: c.secondaryForeground },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timer: { minWidth: 33, textAlign: 'center', fontFamily: fonts.mono, fontSize: 11, color: c.secondaryForeground },
  timerHot: { color: c.primaryForeground, backgroundColor: c.primary, borderRadius: 3, overflow: 'hidden' },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.background },
  next: { width: 38, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: c.primary },
  disabled: { opacity: 0.55 },
  mapArea: { flex: 1, minHeight: 120, position: 'relative', overflow: 'hidden', backgroundColor: c.mapBackdrop },
  eventBadge: { position: 'absolute', top: 8, alignSelf: 'center', maxWidth: '55%', minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, borderWidth: 1, borderColor: c.foreground, borderRadius: 5, backgroundColor: c.primary, shadowColor: c.foreground, shadowOpacity: 0.2, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  eventBadgeText: { flexShrink: 1, fontFamily: fonts.sansSemiBold, fontSize: 11, color: c.primaryForeground },
  queueCount: { fontFamily: fonts.mono, fontSize: 10, color: c.primaryForeground },
  listButton: { position: 'absolute', top: 8, right: 8, height: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, borderWidth: 1, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.card, shadowColor: c.foreground, shadowOpacity: 0.16, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  listButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 11, color: c.foreground },
  tapHint: { position: 'absolute', left: 0, right: 0, bottom: 9, alignItems: 'center' },
  tapHintText: { backgroundColor: 'rgba(59,43,33,0.9)', color: c.secondaryForeground, fontFamily: fonts.sans, fontSize: 10, paddingHorizontal: 9, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
  chronicleDock: { position: 'absolute', right: 8, bottom: 8, maxWidth: '72%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  latestEntry: { maxWidth: 220, flex: 1, paddingHorizontal: 9, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(44,30,23,0.5)', borderRadius: 4, backgroundColor: 'rgba(59,43,33,0.88)' },
  latestText: { fontFamily: fonts.sans, fontSize: 10, color: c.secondaryForeground },
  chatButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.foreground, borderRadius: 20, backgroundColor: c.card, shadowColor: c.foreground, shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  chatButtonOpen: { backgroundColor: c.primary },
  overlayPanel: { position: 'absolute', left: 8, right: 8, borderWidth: 1, borderColor: c.foreground, borderRadius: 6, overflow: 'hidden', shadowColor: c.foreground, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  cardOverlay: { top: 48, alignSelf: 'center', maxWidth: 580, backgroundColor: c.card },
  listOverlay: { top: 48, maxWidth: 560, alignSelf: 'center', backgroundColor: c.card },
  logOverlay: { bottom: 8, maxWidth: 700, alignSelf: 'center', backgroundColor: 'rgba(59,43,33,0.94)' },
  overlayHeader: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 11, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
  overlayTitle: { flex: 1, fontFamily: fonts.display, fontSize: 15, color: c.foreground },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  overlayScroll: { flex: 1 },
  overlayScrollContent: { paddingBottom: 12 },
  overlayBody: { flex: 1, minHeight: 0 },
  mapFooter: { height: 44, flexDirection: 'row', alignItems: 'center', backgroundColor: c.background, borderTopWidth: 1, borderTopColor: c.border },
  cityListButton: { height: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, marginRight: 5, borderWidth: 1, borderColor: c.border, borderRadius: 4, backgroundColor: c.secondary },
  cityListText: { fontFamily: fonts.sansSemiBold, fontSize: 10, color: c.secondaryForeground },
});
