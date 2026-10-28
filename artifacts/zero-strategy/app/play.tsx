import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { CardPanel } from '@/components/game/CardPanel';
import { InspectCard } from '@/components/game/InspectCard';
import { LegendPanel } from '@/components/game/LegendPanel';
import { LogPanel } from '@/components/game/LogPanel';
import { MapLegend } from '@/components/game/MapLegend';
import { MapControls } from '@/components/game/MapControls';
import { ModeTabs } from '@/components/game/ModeTabs';
import { Loading } from '@/components/Loading';
import { MapView } from '@/components/map/MapView.web';
import type { MapTool, MapViewHandle } from '@/components/map/types';
import colors, { fonts } from '@/constants/colors';
import { MAP_WIDTH } from '@/game/config';
import { fmt } from '@/game/format';
import {
  Game,
  hasPlayerActionCard,
  type AutomaticEventSample,
  type AutomaticEventStageSample,
  type GameSnapshot,
  type PixelInfo,
} from '@/game/game';
import { AUTO_TURN_HOLD_MS } from '@/game/holdConfirmation';
import { hasMapObjectList } from '@/game/mapModeCapabilities';
import { scheduleMapLegend } from '@/game/mapLegendTimer';
import {
  notificationIsForSubscriber,
  notificationSubscriptionsForViewer,
  type GameNotification,
} from '@/game/notifications';
import { openProfile } from '@/game/profileNavigation';
import { continueSavedGame, currentGame, leaveGame } from '@/game/session';
import { cityProfileRoute, countryProfileRoute } from '@/game/profileRoutes';
import type { MapMode } from '@/game/render';
import { isActiveCountry } from '@/game/world';
import { useGameSnapshot } from '@/game/useGame';

const c = colors.light;

declare global {
  interface Window {
    __ZERO_STRATEGY_NOTIFICATION_TEST__?: {
      advanceTurn: () => Promise<void>;
      getSnapshot: () => GameSnapshot;
      getNotificationsAfter: (sequence: number) => GameNotification[];
      getRoutedNotificationIds: () => number[];
      getDisplayableNotificationIds: () => number[];
      getActiveCountryIds: () => number[];
    };
    __ZERO_STRATEGY_PERFORMANCE_TEST__?: {
      advanceTurn: () => Promise<void>;
      getSnapshot: () => GameSnapshot;
      takeSamples: () => AutomaticEventSample[];
      takeStages: () => AutomaticEventStageSample[];
    };
  }
}

function goHome() {
  if (router.canGoBack()) router.back();
  else router.replace('/');
}

function mapListCount(game: Game, snap: GameSnapshot): number | null {
  switch (snap.mapMode) {
    case 'political':
      return snap.legend.countries.length;
    case 'cultures':
      return snap.legend.cultures.length;
    case 'religions':
      return snap.legend.religions.length;
    case 'origins':
      return snap.legend.origins.length;
    case 'cities':
      return game.world.cities.length;
    default:
      return null;
  }
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
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') void game.saveNow();
    };
    const saveBeforeExit = () => void game.saveNow();
    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('pagehide', saveBeforeExit);
    return () => {
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('pagehide', saveBeforeExit);
    };
  }, [game]);

  if (failed) return <Loading text={`Не удалось открыть сохранение: ${failed}`} />;
  if (!game) return <Loading text="Открываем атлас…" />;
  return <GameScreen game={game} />;
}

function GameScreen({ game }: { game: Game }) {
  const notificationE2e = process.env.EXPO_PUBLIC_NOTIFICATION_E2E === 'true';
  if (notificationE2e) Game.notificationE2eFastMode = true;
  const snap = useGameSnapshot(game);
  const { height, width } = useWindowDimensions();
  const mapRef = useRef<MapViewHandle>(null);
  const zoomTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardHelpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastLogLine = useRef<string | undefined>(undefined);
  const [tool, setTool] = useState<MapTool>('hand');
  const [inspect, setInspect] = useState<{ info: PixelInfo | null } | null>(null);
  const [hint, setHint] = useState('');
  const hintSource = useRef<'local' | 'notification' | null>(null);
  const [pendingNotifications, setPendingNotifications] = useState<GameNotification[]>([]);
  const lastNotificationSequence = useRef(0);
  const routedNotificationIds = useRef<number[]>([]);
  const displayableNotificationIds = useRef<number[]>([]);
  const [listMode, setListMode] = useState<MapMode | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  const [cardHelpOpen, setCardHelpOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [logPreview, setLogPreview] = useState(false);
  const [zoomVisible, setZoomVisible] = useState(false);
  const [legendVisible, setLegendVisible] = useState(true);
  const [holdingNext, setHoldingNext] = useState(false);
  const longPressFired = useRef(false);

  const canBrush = snap.canPaint && !snap.busy;
  const canPlaceCity = snap.cityPlacementAvailable && !snap.busy;
  const canOpenEvent = hasPlayerActionCard(snap);
  const activeCard = canOpenEvent ? snap.card : null;
  const notificationCountryId = snap.focusCountry?.id ??
    (snap.role === 'country' && snap.card?.type === 'create' ? snap.card.newCountryId : null);
  const notificationSubscriptions = useMemo(
    () => notificationSubscriptionsForViewer(snap.role, notificationCountryId),
    [snap.role, notificationCountryId],
  );
  const activeNotification = pendingNotifications[0] ?? null;
  const canOpenChoices = canOpenEvent && snap.card?.choices?.length === 2;
  const showTools = 1 + Number(canBrush) + Number(canPlaceCity) + Number(canOpenChoices) >= 2;
  const mapHeight = Math.max(160, height - 72);
  const overlayHeight = Math.max(140, Math.min(620, mapHeight - 56));

  const onCityPress = useCallback((pixel: number) => {
    mapRef.current?.centerAtPixel(pixel);
    setTool('hand');
    setInspect(null);
  }, [game]);

  const showHint = useCallback((message: string, source: 'local' | 'notification' = 'local') => {
    setHint(message);
    hintSource.current = source;
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => {
      setHint('');
      hintSource.current = null;
      hintTimer.current = null;
    }, 2600);
  }, []);

  const changeTool = useCallback((nextTool: MapTool) => {
    setTool(nextTool);
    if (nextTool !== 'hand') setInspect(null);
    if (nextTool === 'brush') showHint('Проведите кистью по карте.');
    else if (nextTool === 'city') {
      const target = snap.card?.targetCountryId == null ? null : game.world.countries[snap.card.targetCountryId];
      showHint(target?.type === 'nomadic'
        ? 'Коснитесь свободной точки суши в ареале кочевья.'
        : 'Коснитесь незанятой точки своей страны, чтобы поставить город.');
    } else {
      showHint('Коснитесь точки на карте, чтобы её изучить.');
    }
  }, [game, showHint, snap.card]);

  const openCardHelp = useCallback(() => {
    if (cardHelpTimer.current) clearTimeout(cardHelpTimer.current);
    cardHelpTimer.current = null;
    setCardHelpOpen(true);
  }, []);

  const closeCardHelp = useCallback(() => {
    if (cardHelpTimer.current) clearTimeout(cardHelpTimer.current);
    cardHelpTimer.current = setTimeout(() => {
      setCardHelpOpen(false);
      cardHelpTimer.current = null;
    }, 180);
  }, []);

  useEffect(() => {
    if (!canBrush && tool === 'brush') setTool('hand');
    if (!canPlaceCity && tool === 'city') setTool('hand');
  }, [canBrush, canPlaceCity, tool]);

  useEffect(() => {
    setListMode(null);
  }, [snap.mapMode]);

  useEffect(() => {
    if (hasMapObjectList(snap.mapMode)) {
      setLegendVisible(false);
      return;
    }
    return scheduleMapLegend(setLegendVisible);
  }, [snap.mapMode]);

  useEffect(() => {
    if (!canOpenChoices) setCardOpen(false);
  }, [canOpenChoices]);

  useEffect(() => {
    if (cardHelpTimer.current) clearTimeout(cardHelpTimer.current);
    cardHelpTimer.current = null;
    setCardHelpOpen(false);
  }, [activeCard?.type, activeCard?.title, activeCard?.detail]);

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
    if (hintTimer.current) clearTimeout(hintTimer.current);
    if (cardHelpTimer.current) clearTimeout(cardHelpTimer.current);
  }, []);

  useEffect(() => {
    const unseen = game.notificationsAfter(lastNotificationSequence.current);
    if (!unseen.length) return;
    lastNotificationSequence.current = unseen[unseen.length - 1].id;
    const routed = unseen.filter((event) =>
      notificationIsForSubscriber(event.recipient, notificationSubscriptions),
    );
    if (notificationE2e) routedNotificationIds.current.push(...routed.map(({ id }) => id));
    const displayable = routed.filter((event) => event.message !== snap.card?.detail);
    if (notificationE2e) displayableNotificationIds.current.push(...displayable.map(({ id }) => id));
    if (displayable.length) {
      setPendingNotifications((current) => [...current, ...displayable]);
    }
  }, [game, notificationE2e, snap.notificationSequence, snap.card?.detail, notificationSubscriptions]);

  useEffect(() => {
    if (snap.role !== 'observer') return;
    setPendingNotifications([]);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = null;
    hintSource.current = null;
    setHint('');
  }, [snap.role]);

  useEffect(() => {
    if (!activeNotification || snap.role === 'observer') {
      return;
    }
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setHint(activeNotification.message);
    hintSource.current = 'notification';
    hintTimer.current = setTimeout(() => {
      setHint((current) => current === activeNotification.message ? '' : current);
      hintSource.current = null;
      hintTimer.current = null;
      setPendingNotifications((current) =>
        current[0]?.id === activeNotification.id ? current.slice(1) : current,
      );
    }, process.env.EXPO_PUBLIC_NOTIFICATION_E2E === 'true' ? 100 : 2600);
    return () => {
      if (hintTimer.current) clearTimeout(hintTimer.current);
      hintTimer.current = null;
    };
  }, [activeNotification?.id, snap.role]);

  useEffect(() => {
    if (process.env.EXPO_PUBLIC_NOTIFICATION_E2E !== 'true') return;
    const previousPersist = Game.persist;
    const previousPause = Game.pause;
    const previousFastMode = Game.notificationE2eFastMode;
    Game.persist = false;
    Game.pause = async () => {};
    Game.notificationE2eFastMode = true;
    game.stop();
    const bridge = {
      advanceTurn: () => game.nextTurn(true),
      getSnapshot: () => game.getSnapshot(),
      getNotificationsAfter: (sequence: number) => game.notificationsAfter(sequence),
      getRoutedNotificationIds: () => [...routedNotificationIds.current],
      getDisplayableNotificationIds: () => [...displayableNotificationIds.current],
      getActiveCountryIds: () => game.world.countries.filter(isActiveCountry).map(({ id }) => id),
    };
    window.__ZERO_STRATEGY_NOTIFICATION_TEST__ = bridge;
    return () => {
      if (window.__ZERO_STRATEGY_NOTIFICATION_TEST__ === bridge) {
        delete window.__ZERO_STRATEGY_NOTIFICATION_TEST__;
      }
      Game.persist = previousPersist;
      Game.pause = previousPause;
      Game.notificationE2eFastMode = previousFastMode;
    };
  }, [game]);

  useEffect(() => {
    if (process.env.EXPO_PUBLIC_PERF_BENCHMARK !== 'true') return;
    const previousPersist = Game.persist;
    Game.persist = false;
    game.stop();
    game.setPerformanceTracking(true);
    const bridge = {
      advanceTurn: () => game.nextTurn(true),
      getSnapshot: () => game.getSnapshot(),
      takeSamples: () => game.takePerformanceSamples(),
      takeStages: () => game.takePerformanceStageSamples(),
    };
    window.__ZERO_STRATEGY_PERFORMANCE_TEST__ = bridge;
    return () => {
      if (window.__ZERO_STRATEGY_PERFORMANCE_TEST__ === bridge) {
        delete window.__ZERO_STRATEGY_PERFORMANCE_TEST__;
      }
      game.setPerformanceTracking(false);
      Game.persist = previousPersist;
    };
  }, [game]);

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

  const log = useMemo(() => <LogPanel log={snap.chronicle} world={game.world} transparent minimal />,
    [snap.chronicle, game.world]);
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
            : snap.card?.type === 'marriage' || snap.card?.type === 'birth' || snap.card?.type === 'trait'
              ? 'Далее'
              : 'Следующий год';
  const latestText = snap.log[0]?.replace(/^\d+:\s*/, '') ?? '';
  const listTitle = listMode === 'cities' ? 'Города' : listMode === 'origins' ? 'Расы' : 'Список объектов';
  const currentListCount = mapListCount(game, snap);
  const selectedInfo = inspect?.info ? game.inspect(inspect.info.x, inspect.info.y) : null;
  const inkShare = snap.card && snap.card.inkTotal > 0
    ? Math.max(0, Math.min(1, snap.card.ink / snap.card.inkTotal))
    : 0;

  return (
    <View style={styles.screen}>
      <View style={styles.inkTrack} testID="map-ink-status" accessibilityLabel="Остаток чернил">
        <View style={[styles.inkFill, { width: `${inkShare * 100}%` }]} />
      </View>
      <View style={styles.titleRow}>
        <Text style={styles.brand} numberOfLines={1}>Zero Strategy</Text>
        {activeCard && (
          <View style={styles.cardTitleAnchor}>
            <Pressable
              onPress={() => setCardHelpOpen(true)}
              onHoverIn={openCardHelp}
              onHoverOut={closeCardHelp}
              onFocus={openCardHelp}
              onBlur={closeCardHelp}
              style={styles.cardTitleButton}
              accessibilityRole="button"
              accessibilityLabel={`Активная карта: ${activeCard.title}`}
              accessibilityHint="Наведите указатель или коснитесь, чтобы открыть инструкцию."
              accessibilityState={{ expanded: cardHelpOpen }}
              testID="button-active-card"
            >
              <Text style={styles.cardTitleText} numberOfLines={1}>{activeCard.title}</Text>
              <Feather name={cardHelpOpen ? 'chevron-up' : 'info'} size={12} color={c.primaryForeground} />
            </Pressable>
            {cardHelpOpen && (
              <Pressable
                accessible={false}
                onHoverIn={openCardHelp}
                onHoverOut={closeCardHelp}
                style={[styles.cardHelp, { width: Math.max(220, Math.min(360, width - 20)) }]}
                testID="card-help-tooltip"
              >
                <ScrollView nestedScrollEnabled style={styles.cardHelpScroll}>
                  <Text style={styles.cardHelpText}>{activeCard.detail}</Text>
                </ScrollView>
              </Pressable>
            )}
          </View>
        )}
      </View>
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
            onPress={() => {
              if (longPressFired.current) {
                longPressFired.current = false;
                return;
              }
              if (!snap.card || snap.canCompleteCard) void game.nextTurn();
            }}
            onPressIn={() => {
              longPressFired.current = false;
              setHoldingNext(!!snap.card && !snap.canCompleteCard);
            }}
            // Для удержания кнопки в браузере явно подключён обработчик долгого нажатия.
            onLongPress={snap.card && !snap.canCompleteCard && !snap.busy ? () => {
              longPressFired.current = true;
              setHoldingNext(false);
              void game.nextTurn(true);
            } : undefined}
            delayLongPress={AUTO_TURN_HOLD_MS}
            onPressOut={() => setHoldingNext(false)}
            disabled={snap.busy}
            style={({ pressed }) => [styles.next, (snap.busy || pressed) && styles.disabled]}
            testID="button-next"
            accessibilityLabel={nextLabel}
            accessibilityHint={snap.card && !snap.canCompleteCard
              ? 'Удерживайте 3 секунды, чтобы автоматически завершить карточку.'
              : undefined}
          >
            <Feather name="skip-forward" size={15} color={c.primaryForeground} />
          </Pressable>
        </View>
      </View>

      <View style={styles.mapArea}>
        {notificationE2e
          ? <View style={styles.e2eMapPlaceholder} testID="notification-test-map" />
          : (
            <MapView
              ref={mapRef}
              game={game}
              tool={tool}
              canPaint={canBrush}
              avoidToolOverlay={showTools}
              onInspect={(info) => setInspect({ info })}
              onMapActivity={showZoomForAWhile}
            />
          )}
        {holdingNext && snap.card && (
          <View style={styles.holdHint} pointerEvents="none" testID="hint-hold-next">
            <Text style={styles.holdHintText}>Удерживайте 3 секунды для автохода</Text>
          </View>
        )}
        {!notificationE2e && (
          <MapControls
            game={game}
            snap={snap}
            tool={tool}
            setTool={changeTool}
            showTools={showTools}
            showBrush={canBrush}
            showCity={canPlaceCity}
            compact={width < 420}
            showChoice={canOpenChoices}
            choiceOpen={cardOpen}
            onToggleChoice={() => setCardOpen((open) => {
              const next = !open;
              if (next) {
                setListMode(null);
                setLogOpen(false);
              }
              return next;
            })}
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
        )}

        {hasMapObjectList(snap.mapMode) && (
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
            accessibilityLabel={`Открыть список объектов: ${fmt(currentListCount ?? 0)}`}
          >
            <Feather name="list" size={15} color={c.foreground} />
            <Text style={styles.listButtonText}>Список</Text>
            {currentListCount !== null && (
              <View style={styles.listCountBadge} testID={`map-list-count-${snap.mapMode}`}>
                <Text style={styles.listCountText}>{fmt(currentListCount)}</Text>
              </View>
            )}
          </Pressable>
        )}

        {!notificationE2e && legendVisible && !hasMapObjectList(snap.mapMode) && !cardOpen && !listMode && !logOpen && (
          <MapLegend game={game} snap={snap} />
        )}

        {tool === 'hand' && inspect && (
          <InspectCard
            info={selectedInfo}
            onClose={() => setInspect(null)}
            onCountryPress={(id) => openProfile(countryProfileRoute(id))}
            onCityPress={(id) => openProfile(cityProfileRoute(id))}
          />
        )}
        {snap.role !== 'observer' && !!hint && (
          <View
            style={styles.hintToast}
            pointerEvents="none"
            testID="map-hint-toast"
            accessibilityLabel={hintSource.current === 'notification' ? `Уведомление: ${hint}` : hint}
            nativeID={hintSource.current === 'notification' && activeNotification ? `notification-${activeNotification.id}` : undefined}
          >
            <Text style={styles.hintToastText} numberOfLines={2}>{hint}</Text>
          </View>
        )}

        {!logOpen && (
          <View style={styles.chronicleDock}>
            {logPreview && !!latestText && (
              <Pressable style={styles.latestEntry} onPress={() => {
                setCardOpen(false);
                setListMode(null);
                setLogOpen(true);
              }} testID="text-latest-log" accessibilityLabel="Последняя запись летописи">
                <Text style={styles.latestText} numberOfLines={1}>{latestText}</Text>
              </Pressable>
            )}
            <Pressable
              onPress={() => {
                setCardOpen(false);
                setListMode(null);
                setLogOpen(true);
              }}
              style={styles.chatButton}
              testID="button-toggle-log"
              accessibilityRole="button"
              accessibilityLabel="Открыть летопись"
              accessibilityState={{ expanded: false }}
            >
              <Feather name="message-circle" size={17} color={c.foreground} />
            </Pressable>
          </View>
        )}

        {cardOpen && canOpenChoices && (
          <View style={[styles.overlayPanel, styles.cardOverlay, { height: overlayHeight, top: (mapHeight - overlayHeight) / 2 }]}>
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
          <View style={styles.logOverlay} testID="overlay-chronicle">
            <View style={{ flex: 1 }}>{log}</View>
            <Pressable
              onPress={() => setLogOpen(false)}
              style={styles.logCloseButton}
              hitSlop={4}
              testID="button-close-log"
              accessibilityRole="button"
              accessibilityLabel="Закрыть летопись"
              accessibilityState={{ expanded: true }}
            >
              <Feather name="x" size={16} color="#f5eee8" />
            </Pressable>
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  inkTrack: { height: 2, backgroundColor: c.muted, overflow: 'hidden' },
  inkFill: { height: '100%', backgroundColor: c.primary },
  titleRow: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingHorizontal: 10, backgroundColor: c.secondary, zIndex: 40 },
  topBar: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 5, backgroundColor: c.secondary, zIndex: 20 },
  homeButton: { height: 38, flexDirection: 'row', alignItems: 'center', gap: 1, paddingHorizontal: 3 },
  homeText: { fontFamily: fonts.sans, fontSize: 11, color: c.secondaryForeground },
  yearBlock: { flexDirection: 'row', alignItems: 'baseline', gap: 3, paddingHorizontal: 4 },
  year: { fontFamily: fonts.display, fontSize: 18, color: c.secondaryForeground },
  yearCaption: { fontFamily: fonts.sansMedium, fontSize: 8, letterSpacing: 0.6, color: c.secondaryForeground, opacity: 0.65 },
  brand: { fontFamily: fonts.displayItalic, fontSize: 13, color: c.secondaryForeground },
  cardTitleAnchor: { position: 'relative', maxWidth: '68%', alignItems: 'flex-end', zIndex: 41 },
  cardTitleButton: { minHeight: 24, maxWidth: '100%', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, borderRadius: 3, backgroundColor: c.primary },
  cardTitleText: { flexShrink: 1, fontFamily: fonts.sansSemiBold, fontSize: 10, color: c.primaryForeground },
  cardHelp: { position: 'absolute', top: 28, right: 0, maxHeight: 172, zIndex: 42, overflow: 'hidden', borderWidth: 1, borderColor: c.foreground, borderRadius: 5, backgroundColor: c.card, shadowColor: c.foreground, shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 10 },
  cardHelpScroll: { maxHeight: 170 },
  cardHelpText: { paddingHorizontal: 11, paddingVertical: 9, fontFamily: fonts.sans, fontSize: 12, lineHeight: 17, color: c.foreground },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  timer: { minWidth: 33, textAlign: 'center', fontFamily: fonts.mono, fontSize: 11, color: c.secondaryForeground },
  timerHot: { color: c.primaryForeground, backgroundColor: c.primary, borderRadius: 3, overflow: 'hidden' },
  iconButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.background },
  next: { width: 38, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: c.primary },
  disabled: { opacity: 0.55 },
  mapArea: { flex: 1, minHeight: 120, position: 'relative', overflow: 'hidden', backgroundColor: c.mapBackdrop },
  e2eMapPlaceholder: { flex: 1, backgroundColor: c.mapBackdrop },
  holdHint: { position: 'absolute', top: 48, alignSelf: 'center', zIndex: 30, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.72)' },
  holdHintText: { fontFamily: fonts.sansMedium, fontSize: 11, color: c.primaryForeground },
  listButton: { position: 'absolute', top: 8, right: 8, height: 34, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, borderWidth: 1, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.card, shadowColor: c.foreground, shadowOpacity: 0.16, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3 },
  listButtonText: { fontFamily: fonts.sansSemiBold, fontSize: 11, color: c.foreground },
  listCountBadge: { minWidth: 23, height: 22, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5, borderRadius: 3, backgroundColor: c.primary },
  listCountText: { fontFamily: fonts.mono, fontSize: 10, color: c.primaryForeground },
  hintToast: { position: 'absolute', left: '8%', right: '8%', bottom: 58, alignItems: 'center', zIndex: 5 },
  hintToastText: { maxWidth: '100%', overflow: 'hidden', borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.72)', paddingHorizontal: 10, paddingVertical: 6, fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 15, color: '#fff', textAlign: 'center' },
  chronicleDock: { position: 'absolute', right: 8, bottom: 8, maxWidth: '72%', flexDirection: 'row', alignItems: 'center', gap: 6 },
  latestEntry: { maxWidth: 220, flex: 1, paddingHorizontal: 9, paddingVertical: 7, borderWidth: 1, borderColor: 'rgba(44,30,23,0.5)', borderRadius: 4, backgroundColor: 'rgba(59,43,33,0.88)' },
  latestText: { fontFamily: fonts.sans, fontSize: 10, color: c.secondaryForeground },
  chatButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.foreground, borderRadius: 20, backgroundColor: c.card, shadowColor: c.foreground, shadowOpacity: 0.18, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 4 },
  chatButtonOpen: { backgroundColor: c.primary },
  overlayPanel: { position: 'absolute', left: 8, right: 8, borderWidth: 1, borderColor: c.foreground, borderRadius: 6, overflow: 'hidden', shadowColor: c.foreground, shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, elevation: 8 },
  cardOverlay: { alignSelf: 'center', maxWidth: 580, backgroundColor: c.card },
  listOverlay: { top: 48, maxWidth: 560, alignSelf: 'center', backgroundColor: c.card },
  logOverlay: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 10, backgroundColor: 'rgba(17,21,27,0.9)' },
  logCloseButton: { position: 'absolute', top: 6, right: 6, zIndex: 11, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, borderWidth: 1, borderColor: 'rgba(245,238,232,0.4)', backgroundColor: 'rgba(17,21,27,0.96)' },
  overlayHeader: { minHeight: 38, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingLeft: 11, borderBottomWidth: 1, borderBottomColor: c.border, backgroundColor: c.card },
  overlayTitle: { flex: 1, fontFamily: fonts.display, fontSize: 15, color: c.foreground },
  closeButton: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  overlayScroll: { flex: 1 },
  overlayScrollContent: { paddingBottom: 12 },
  overlayBody: { flex: 1, minHeight: 0 },
});
