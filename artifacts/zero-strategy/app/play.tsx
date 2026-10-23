import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CardPanel } from '@/components/game/CardPanel';
import { InspectCard } from '@/components/game/InspectCard';
import { LegendPanel } from '@/components/game/LegendPanel';
import { LogPanel } from '@/components/game/LogPanel';
import { MapControls } from '@/components/game/MapControls';
import { ModeTabs } from '@/components/game/ModeTabs';
import { Loading } from '@/components/Loading';
import { MapView } from '@/components/map/MapView';
import type { MapTool, MapViewHandle } from '@/components/map/types';
import colors, { fonts } from '@/constants/colors';
import { MAP_WIDTH } from '@/game/config';
import type { Game, PixelInfo } from '@/game/game';
import { continueSavedGame, currentGame, leaveGame } from '@/game/session';
import { useGameSnapshot } from '@/game/useGame';

const c = colors.light;
const WIDE = 900;

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

  // Save as soon as the app goes to the background: the system may close it there.
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
  const { width, height } = useWindowDimensions();
  const mapRef = useRef<MapViewHandle>(null);
  const [tool, setTool] = useState<MapTool>('brush');
  const [inspect, setInspect] = useState<{ info: PixelInfo | null } | null>(null);
  const onCityPress = useCallback((pixel: number) => {
    const x = pixel % MAP_WIDTH;
    const y = Math.floor(pixel / MAP_WIDTH);
    mapRef.current?.centerAtPixel(pixel);
    setTool('hand');
    setInspect({ info: game.inspect(x, y) });
  }, [game]);
  const changeTool = (t: MapTool) => {
    setTool(t);
    if (t === 'brush') setInspect(null);
  };

  // Lists only re-render when their own data changes, not on every brush dab or timer tick.
  const legend = useMemo(() => <LegendPanel game={game} snap={snap} onCityPress={onCityPress} />, [game, onCityPress, snap.legend, snap.mapMode, snap.layer, snap.selectedCountryId]); // eslint-disable-line react-hooks/exhaustive-deps
  const log = useMemo(() => <LogPanel log={snap.log} />, [snap.log]);

  const wide = width >= WIDE;
  const selectedInfo = inspect?.info ? game.inspect(inspect.info.x, inspect.info.y) : null;
  const topBar = (
    <View style={styles.topBar}>
      <Pressable onPress={goHome} style={styles.menu} hitSlop={8} testID="link-home">
        <Feather name="chevron-left" size={16} color={c.secondaryForeground} />
        <Text style={styles.menuText}>Меню</Text>
      </Pressable>
      <Text style={styles.brand}>Zero Strategy</Text>
    </View>
  );

  const map = (
    <View style={styles.mapArea}>
      <MapView ref={mapRef} game={game} tool={tool} canPaint={snap.canPaint && !snap.busy} onInspect={(info) => setInspect({ info })} />
      <MapControls game={game} snap={snap} tool={tool} setTool={changeTool} onZoom={(f) => mapRef.current?.zoomBy(f)} onFit={() => mapRef.current?.fit()} />
      {tool === 'hand' && inspect && (
        <InspectCard info={selectedInfo} world={game.world} onClose={() => setInspect(null)}
          onPersonPress={(id) => router.push({ pathname: '/person/[id]', params: { id: String(id) } })}
          onDynastyPress={(familyId) => router.push({ pathname: '/dynasty/[id]', params: { id: String(familyId) } })} />
      )}
      {tool === 'hand' && !inspect && (
        <View style={styles.tapHint} pointerEvents="none">
          <Text style={styles.tapHintText}>Коснитесь точки, чтобы её изучить</Text>
        </View>
      )}
    </View>
  );

  if (wide) {
    return (
      <View style={[styles.screen, styles.row, { paddingTop: insets.top }]}>
        {map}
        <View style={styles.aside}>
          {topBar}
          <CardPanel game={game} snap={snap} />
          <ModeTabs game={game} snap={snap} />
          <View style={{ flex: 1 }}>{legend}</View>
          <View style={[styles.logBox, { height: height * 0.24 }]}>{log}</View>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top }]}>
      {topBar}
      <CardPanel game={game} snap={snap} />
      {map}
      <ModeTabs game={game} snap={snap} />
      <View style={{ height: height * 0.2 }}>{legend}</View>
      <View style={[styles.logBox, { height: height * 0.15 + insets.bottom, paddingBottom: insets.bottom }]}>{log}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: c.background },
  row: { flexDirection: 'row' },
  topBar: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.secondary, paddingHorizontal: 8, paddingVertical: 6 },
  menu: { flexDirection: 'row', alignItems: 'center', gap: 2, opacity: 0.85 },
  menuText: { fontFamily: fonts.sans, fontSize: 12, color: c.secondaryForeground },
  brand: { marginLeft: 'auto', fontFamily: fonts.displayItalic, fontSize: 14, color: c.secondaryForeground },
  mapArea: { flex: 1, minHeight: 120 },
  aside: { width: 380, borderLeftWidth: 2, borderLeftColor: c.foreground, backgroundColor: c.card },
  logBox: { borderTopWidth: 2, borderTopColor: c.foreground, backgroundColor: c.secondary },
  tapHint: { position: 'absolute', bottom: 8, left: 0, right: 0, alignItems: 'center' },
  tapHintText: { backgroundColor: 'rgba(59,43,33,0.9)', color: c.secondaryForeground, fontFamily: fonts.sans, fontSize: 11, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
});
