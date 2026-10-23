import {
  AlphaType,
  Canvas,
  Circle,
  ColorType,
  FilterMode,
  Group,
  Image as SkiaImage,
  MipmapMode,
  Skia,
  type SkImage,
} from '@shopify/react-native-skia';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { makeMutable, useDerivedValue, useSharedValue } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { MAP_WIDTH } from '@/game/config';
import { STRIP_H, STRIPS } from '@/game/render';
import { MapGestures } from './gestures';
import { PAINT_BUDGET_MS, type MapViewHandle, type MapViewProps, type ViewTransform } from './types';
import { clampView, initialView, minScale, zoomAround } from './viewMath';

const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };
const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

function makeStrip(pixels: Uint32Array, strip: number): SkImage | null {
  const start = strip * STRIP_H * MAP_WIDTH * 4;
  const bytes = new Uint8Array(pixels.buffer, start, STRIP_H * MAP_WIDTH * 4).slice();
  const data = Skia.Data.fromBytes(bytes);
  return Skia.Image.MakeImage(
    { width: MAP_WIDTH, height: STRIP_H, alphaType: AlphaType.Opaque, colorType: ColorType.RGBA_8888 },
    data,
    MAP_WIDTH * 4,
  );
}

/** Phone map: Skia canvas with pan, pinch zoom, brush painting and tap-to-inspect. */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView({ game, tool, canPaint, onInspect }, ref) {
  const sizeRef = useRef({ width: 1, height: 1 });
  const viewRef = useRef<ViewTransform>({ scale: 1, ox: 0, oy: 0 });
  const laidOut = useRef(false);
  const toolRef = useRef(tool);
  const canPaintRef = useRef(canPaint);
  const inspectRef = useRef(onInspect);
  toolRef.current = tool;
  canPaintRef.current = canPaint;
  inspectRef.current = onInspect;

  const scale = useSharedValue(1);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const cursorX = useSharedValue(0);
  const cursorY = useSharedValue(0);
  const cursorR = useSharedValue(0);
  const cursorOpacity = useSharedValue(0);
  const strips = useMemo(() => Array.from({ length: STRIPS }, () => makeMutable<SkImage | null>(null)), []);

  const transform = useDerivedValue(() => [{ translateX: ox.value }, { translateY: oy.value }, { scale: scale.value }]);
  const sampling = useDerivedValue(() => (scale.value >= 1 ? NEAREST : LINEAR));

  const applyView = (view: ViewTransform) => {
    viewRef.current = view;
    scale.value = view.scale;
    ox.value = view.ox;
    oy.value = view.oy;
  };

  useImperativeHandle(ref, () => ({
    zoomBy: (factor: number) => {
      const { width, height } = sizeRef.current;
      applyView(zoomAround(viewRef.current, factor, width / 2, height / 2, width, height));
    },
    fit: () => {
      const { width, height } = sizeRef.current;
      applyView(clampView({ scale: minScale(width, height), ox: 0, oy: 0 }, width, height));
    },
  }));

  // Repaint loop: renders dirty rows within a time budget each frame and uploads touched strips.
  useEffect(() => {
    let frame: number | null = null;
    let alive = true;
    const pump = () => {
      frame = null;
      if (!alive) return;
      // The map is uploaded as full-width strips, each only once all its changed tiles are painted.
      for (const s of game.renderer.flushSome(PAINT_BUDGET_MS)) {
        const old = strips[s].value;
        strips[s].value = makeStrip(game.renderer.pixels, s);
        // Free the GPU copy once the new strip has been on screen for a while.
        if (old) setTimeout(() => old.dispose(), 1000);
      }
      if (game.renderer.pending) frame = requestAnimationFrame(pump);
      else game.mapDrawn();
    };
    const request = () => {
      if (frame === null && alive) frame = requestAnimationFrame(pump);
    };
    game.redrawAll();
    request();
    const off = game.onMapChange(request);
    return () => {
      alive = false;
      off();
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [game, strips]);

  const gestures = useMemo(
    () =>
      new MapGestures({
        game,
        getView: () => viewRef.current,
        setView: applyView,
        size: () => sizeRef.current,
        tool: () => toolRef.current,
        canPaint: () => canPaintRef.current,
        onInspect: (info) => inspectRef.current?.(info),
        setCursor: (point) => {
          if (!point) {
            cursorOpacity.value = 0;
            return;
          }
          cursorX.value = point.x;
          cursorY.value = point.y;
          cursorR.value = game.brushRadius * viewRef.current.scale;
          cursorOpacity.value = 1;
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [game],
  );

  const onLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    sizeRef.current = { width: Math.max(1, width), height: Math.max(1, height) };
    if (!laidOut.current) {
      laidOut.current = true;
      applyView(initialView(sizeRef.current.width, sizeRef.current.height));
    } else applyView(clampView(viewRef.current, sizeRef.current.width, sizeRef.current.height));
  };

  // Touch positions relative to the map: page coordinates minus the view's page offset.
  const offset = useRef({ x: 0, y: 0 });
  const touches = (event: GestureResponderEvent) =>
    event.nativeEvent.touches.map((t) => ({ id: Number(t.identifier), x: t.pageX - offset.current.x, y: t.pageY - offset.current.y }));
  const onGrant = (event: GestureResponderEvent) => {
    const e = event.nativeEvent;
    offset.current = { x: e.pageX - e.locationX, y: e.pageY - e.locationY };
    gestures.sync(touches(event));
  };
  const onTouch = (event: GestureResponderEvent) => gestures.sync(touches(event));
  const onRelease = () => gestures.releaseAll();

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group transform={transform}>
          {strips.map((image, s) => (
            <SkiaImage key={s} image={image} x={0} y={s * STRIP_H} width={MAP_WIDTH} height={STRIP_H} sampling={sampling} />
          ))}
        </Group>
        <Group opacity={cursorOpacity}>
          <Circle cx={cursorX} cy={cursorY} r={cursorR} style="stroke" strokeWidth={3} color="rgba(255,255,255,0.9)" />
          <Circle cx={cursorX} cy={cursorY} r={cursorR} style="stroke" strokeWidth={1.2} color="rgba(30,26,20,0.9)" />
        </Group>
      </Canvas>
      <View
        style={StyleSheet.absoluteFill}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={onGrant}
        onResponderStart={onTouch}
        onResponderMove={onTouch}
        onResponderEnd={onTouch}
        onResponderRelease={onRelease}
        onResponderTerminate={onRelease}
        testID="map-touch"
      />
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: colors.light.mapBackdrop },
});
