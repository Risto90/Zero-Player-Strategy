import {
  AlphaType,
  Canvas,
  Circle,
  ColorType,
  FilterMode,
  Group,
  Image as SkiaImage,
  Line,
  MipmapMode,
  Path,
  Skia,
  Text as SkiaText,
  TextPath,
  useImage,
  useFont,
  type SkImage,
} from '@shopify/react-native-skia';
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type LayoutChangeEvent } from 'react-native';
import { makeMutable, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import colors from '@/constants/colors';
import { MAP_WIDTH } from '@/game/config';
import { STRIP_H, STRIPS } from '@/game/render';
import { countryLabelViewportLayout, countryMapLabels, geographicVisibilityScale, volcanoVisibilityScale } from '@/game/mapLabels';
import { discoveredRiverPaths, riverVisibilityScale } from '@/game/geographyGeometry';
import { cityInfluenceRadius } from '@/game/settlements';
import type { GeographyFeature } from '@/game/geographyFeatures';
import type { City, World } from '@/game/world';
import { circleHatchLines } from './cityInfluenceHatching';
import { CITY_ICON_SOURCES, cityIconIndex, cityVisibilityRank } from './cityIcons';
import { isCityVisibleAtZoom } from './cityIconMath';
import { MapGestures } from './gestures';
import { PAINT_BUDGET_MS, type MapViewHandle, type MapViewProps, type ViewTransform } from './types';
import { centerOnMapPoint, clampView, initialView, minScale, zoomAround } from './viewMath';

const NEAREST = { filter: FilterMode.Nearest, mipmap: MipmapMode.None };
const LINEAR = { filter: FilterMode.Linear, mipmap: MipmapMode.None };

type CityMarkerData = { city: City; iconIndex: number; labelColor: string };

function contrastColor(packed: number): string {
  const red = packed & 255;
  const green = (packed >>> 8) & 255;
  const blue = (packed >>> 16) & 255;
  return (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255 > 0.56 ? '#28231e' : '#fff7df';
}

function CityMarker({ city, iconIndex, image, counterScale, labelColor, font }: CityMarkerData & {
  image: SkImage | null;
  counterScale: ReturnType<typeof useDerivedValue<{ scale: number }[]>>;
  font: ReturnType<typeof useFont>;
}) {
  const x = city.pixel % MAP_WIDTH;
  const y = Math.floor(city.pixel / MAP_WIDTH);
  const size = iconIndex >= 6 ? 30 + city.rank : 24 + city.rank;
  const label = city.name ?? '';
  const labelWidth = label.length * 5.2;
  const labelY = y - size / 2 - 3;
  const crown = useMemo(() => {
    const left = x - labelWidth / 2 - 8;
    return `M ${left} ${labelY - 7} L ${left + 1} ${labelY - 2} L ${left + 3} ${labelY - 5} L ${left + 5} ${labelY - 2} L ${left + 7} ${labelY - 5} L ${left + 9} ${labelY - 2} L ${left + 10} ${labelY - 7} L ${left + 9} ${labelY} L ${left + 1} ${labelY} Z`;
  }, [x, labelWidth, labelY]);
  return (
    <Group origin={{ x, y }} transform={counterScale}>
      {image && <SkiaImage image={image} x={x - size / 2} y={y - size / 2} width={size} height={size} fit="contain" sampling={LINEAR} />}
      {label && font && (
        <>
          {city.capital && <Path path={crown} color="#c5952e" />}
          <SkiaText
            x={x - labelWidth / 2 + (city.capital ? 4 : 0)}
            y={labelY}
            text={label}
            font={font}
            color={labelColor === '#fff7df' ? '#28231e' : '#fff7df'}
            style="stroke"
            strokeWidth={0.75}
          />
          <SkiaText
            x={x - labelWidth / 2 + (city.capital ? 4 : 0)}
            y={labelY}
            text={label}
            font={font}
            color={labelColor}
          />
        </>
      )}
    </Group>
  );
}

function CityMarkerLayer({ zoomRank, cities, scale, baseScale, images, font }: {
  zoomRank: number;
  cities: CityMarkerData[];
  scale: SharedValue<number>;
  baseScale: SharedValue<number>;
  images: (SkImage | null)[];
  font: ReturnType<typeof useFont>;
}) {
  const visible = useDerivedValue(() => isCityVisibleAtZoom(scale.value, baseScale.value, zoomRank) ? 1 : 0);
  const counterScale = useDerivedValue(() => [{ scale: 1 / Math.max(scale.value, 0.08) }]);
  return (
    <Group opacity={visible}>
      {cities.map(({ city, iconIndex, labelColor }) => (
        <CityMarker key={city.id} city={city} iconIndex={iconIndex} image={images[iconIndex]} counterScale={counterScale}
          labelColor={labelColor} font={font} />
      ))}
    </Group>
  );
}

function CityMarkers({ world, scale, baseScale, mapPixels }: {
  world: World;
  scale: SharedValue<number>;
  baseScale: SharedValue<number>;
  mapPixels: Uint32Array;
}) {
  const image0 = useImage(CITY_ICON_SOURCES[0]);
  const image1 = useImage(CITY_ICON_SOURCES[1]);
  const image2 = useImage(CITY_ICON_SOURCES[2]);
  const image3 = useImage(CITY_ICON_SOURCES[3]);
  const image4 = useImage(CITY_ICON_SOURCES[4]);
  const image5 = useImage(CITY_ICON_SOURCES[5]);
  const image6 = useImage(CITY_ICON_SOURCES[6]);
  const image7 = useImage(CITY_ICON_SOURCES[7]);
  const image8 = useImage(CITY_ICON_SOURCES[8]);
  const image9 = useImage(CITY_ICON_SOURCES[9]);
  const image10 = useImage(CITY_ICON_SOURCES[10]);
  const image11 = useImage(CITY_ICON_SOURCES[11]);
  const font = useFont(require('@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf'), 9);
  const images = [image0, image1, image2, image3, image4, image5, image6, image7, image8, image9, image10, image11];
  const byZoomRank = new Map<number, CityMarkerData[]>();
  for (const city of world.cities) {
    const hasPort = world.isCoastal(city.pixel) || world.knownRivers[city.pixel] > 0;
    const zoomRank = cityVisibilityRank(city, hasPort);
    const list = byZoomRank.get(zoomRank) ?? [];
    list.push({ city, iconIndex: cityIconIndex(city, hasPort), labelColor: contrastColor(mapPixels[city.pixel] ?? 0xffeeeeee) });
    byZoomRank.set(zoomRank, list);
  }
  return [...byZoomRank].map(([zoomRank, cities]) => (
    <CityMarkerLayer key={zoomRank} zoomRank={zoomRank} cities={cities} scale={scale} baseScale={baseScale} images={images} font={font} />
  ));
}

function CountryLabelMark({ label, scale, ox, oy, width, height, color, font }: {
  label: ReturnType<typeof countryMapLabels>[number];
  scale: SharedValue<number>;
  ox: SharedValue<number>;
  oy: SharedValue<number>;
  width: SharedValue<number>;
  height: SharedValue<number>;
  color: string;
  font: ReturnType<typeof useFont>;
}) {
  const layout = useDerivedValue(() =>
    countryLabelViewportLayout(label, scale.value, ox.value, oy.value, width.value, height.value));
  const visible = useDerivedValue(() => layout.value.visible ? 1 : 0);
  const shift = useDerivedValue(() => [
    { translateX: (layout.value.x - ox.value) / Math.max(scale.value, 0.0001) - label.x },
    { translateY: (layout.value.y - oy.value) / Math.max(scale.value, 0.0001) - label.y },
  ]);
  const textScale = useDerivedValue(() => [
    { scale: layout.value.fontSize / Math.max(scale.value * 8, 0.0001) },
  ]);
  const characters = [...label.text];
  const tracking = 1.2;
  const widths = characters.map(() => 4.8);
  const textWidth = widths.reduce((sum, item) => sum + item, 0) + Math.max(0, characters.length - 1) * tracking;
  let cursor = label.x - textWidth / 2;
  return (
    <Group opacity={visible}>
      <Group transform={shift}>
        <Group origin={{ x: label.x, y: label.y }} transform={textScale}>
          {font && characters.map((character, index) => {
            const x = cursor;
            cursor += widths[index] + tracking;
            return (
              <Group key={`${label.key}-glyph-${index}`}>
                <SkiaText x={x} y={label.y + 4} text={character} font={font}
                  color={color === '#fff7df' ? '#28231e' : '#fff7df'} style="stroke" strokeWidth={1.4} />
                <SkiaText x={x} y={label.y + 4} text={character} font={font} color={color} />
              </Group>
            );
          })}
        </Group>
      </Group>
    </Group>
  );
}

function GeographyPointMark({ feature, volcano, scale, baseScale, font, color }: {
  feature: GeographyFeature;
  volcano: boolean;
  scale: SharedValue<number>;
  baseScale: SharedValue<number>;
  font: ReturnType<typeof useFont>;
  color: string;
}) {
  const x = feature.pixel % MAP_WIDTH;
  const y = Math.floor(feature.pixel / MAP_WIDTH);
  const active = volcano && feature.active === true;
  const visible = useDerivedValue(() =>
    feature.discoveredBy.length > 0 &&
    (!volcano || (active && scale.value >= volcanoVisibilityScale(
      baseScale.value,
      feature.activityIntervalYears,
      feature.eruptionIntensity,
    ))) &&
    scale.value >= geographicVisibilityScale(baseScale.value, feature.elevation) ? 1 : 0);
  const counterScale = useDerivedValue(() => [{ scale: 1 / Math.max(scale.value, 0.08) }]);
  return (
    <Group origin={{ x, y }} transform={counterScale} opacity={visible}>
      <Path path={`M ${x} ${y - 5} L ${x - 4} ${y + 3} L ${x + 4} ${y + 3} Z`} color={active ? '#bd382c' : volcano ? '#b2763e' : '#594b3c'} />
      {feature.name && font && (
        <>
          <SkiaText x={x - feature.name.length * 3} y={y + 11} text={feature.name} font={font}
            color={color === '#fff7df' ? '#28231e' : '#fff7df'} style="stroke" strokeWidth={1.2} />
          <SkiaText x={x - feature.name.length * 3} y={y + 11} text={feature.name} font={font} color={color} />
        </>
      )}
    </Group>
  );
}

function RiverNameMark({ segment, scale, baseScale, font }: {
  segment: ReturnType<typeof discoveredRiverPaths>[number];
  scale: SharedValue<number>;
  baseScale: SharedValue<number>;
  font: ReturnType<typeof useFont>;
}) {
  const visible = useDerivedValue(() => {
    if (!segment.name || scale.value < Math.max(6, riverVisibilityScale(baseScale.value, segment.strength))) return 0;
    const fontSize = Math.max(6, scale.value);
    return segment.width * scale.value >= fontSize &&
      segment.length * scale.value >= Math.max(30, segment.name.length * fontSize * 0.72) ? 1 : 0;
  });
  if (!segment.name) return null;
  return (
    <Group opacity={visible}>
      {font && (
        <>
          <TextPath path={segment.path} text={segment.name} font={font}
            initialOffset={Math.max(0, (segment.length - segment.name.length * 0.72) / 2)}
            color="#fff" style="stroke" strokeWidth={0.28} />
          <TextPath path={segment.path} text={segment.name} font={font}
            initialOffset={Math.max(0, (segment.length - segment.name.length * 0.72) / 2)}
            color="#17130f" />
        </>
      )}
    </Group>
  );
}

function RiverContourLayer({ strength, path, scale, baseScale }: {
  strength: 1 | 2 | 3;
  path: string;
  scale: SharedValue<number>;
  baseScale: SharedValue<number>;
}) {
  const visible = useDerivedValue(() =>
    scale.value >= riverVisibilityScale(baseScale.value, strength) ? 1 : 0);
  const color = strength === 3 ? '#22537d' : strength === 2 ? '#377497' : '#6699ae';
  return (
    <Group opacity={visible}>
      <Path path={path} color={color} />
    </Group>
  );
}

function MapAnnotations({ game, scale, baseScale, ox, oy, width, height }: {
  game: MapViewProps['game'];
  scale: SharedValue<number>;
  baseScale: SharedValue<number>;
  ox: SharedValue<number>;
  oy: SharedValue<number>;
  width: SharedValue<number>;
  height: SharedValue<number>;
}) {
  const snapshot = game.getSnapshot();
  const labels = countryMapLabels(game.world, 100, snapshot.mapMode, snapshot.selectedCountryId);
  const riverPaths = useMemo(
    () => discoveredRiverPaths(game.world),
    [game.world, game.world.version, game.world.territoryVersion],
  );
  const riverContourGroups = useMemo(() => {
    const groups = new Map<1 | 2 | 3, string[]>();
    for (const segment of riverPaths) {
      const group = groups.get(segment.strength) ?? [];
      group.push(segment.contourPath);
      groups.set(segment.strength, group);
    }
    return [...groups].map(([strength, paths]) => ({ strength, path: paths.join(' ') }));
  }, [riverPaths]);
  const riverNameSegments = useMemo(() => {
    const longest = new Map<number, typeof riverPaths[number]>();
    for (const segment of riverPaths) {
      if (!segment.name) continue;
      const previous = longest.get(segment.riverId);
      if (!previous || segment.length > previous.length) longest.set(segment.riverId, segment);
    }
    return [...longest.values()];
  }, [riverPaths]);
  const countryFont = useFont(require('@expo-google-fonts/ibm-plex-sans/700Bold/IBMPlexSans_700Bold.ttf'), 8);
  const smallFont = useFont(require('@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf'), 6);
  const riverFont = useFont(require('@expo-google-fonts/ibm-plex-sans/400Regular/IBMPlexSans_400Regular.ttf'), 1);
  return (
    <>
      {riverContourGroups.map(({ strength, path }) => <RiverContourLayer key={strength} strength={strength}
        path={path} scale={scale} baseScale={baseScale} />)}
      {labels.map((label) => {
        const pixel = Math.floor(label.y) * MAP_WIDTH + Math.floor(label.x);
        const color = label.selected ? '#e7c56e' : contrastColor(game.renderer.pixels[pixel] ?? 0xffeeeeee);
        return <CountryLabelMark key={label.key} label={label} scale={scale} ox={ox} oy={oy}
          width={width} height={height} color={color} font={countryFont} />;
      })}
      {game.world.peaks.filter((feature) => feature.discoveredBy.length > 0).map((feature) => <GeographyPointMark key={`peak-${feature.id}`} feature={feature}
        volcano={false} scale={scale} baseScale={baseScale} font={smallFont}
        color={contrastColor(game.renderer.pixels[feature.pixel] ?? 0xffeeeeee)} />)}
      {game.world.volcanoes.filter((feature) => feature.discoveredBy.length > 0).map((feature) => <GeographyPointMark key={`volcano-${feature.id}`} feature={feature}
        volcano scale={scale} baseScale={baseScale} font={smallFont}
        color={contrastColor(game.renderer.pixels[feature.pixel] ?? 0xffeeeeee)} />)}
      {riverNameSegments.map((segment) => <RiverNameMark key={`river-${segment.riverId}`} segment={segment}
        scale={scale} baseScale={baseScale} font={riverFont} />)}
    </>
  );
}

function CityInfluenceMark({ city, world, selected, scale, baseScale, ox, oy, width, height }: {
  city: City;
  world: World;
  selected: boolean;
  scale: SharedValue<number>;
  baseScale: SharedValue<number>;
  ox: SharedValue<number>;
  oy: SharedValue<number>;
  width: SharedValue<number>;
  height: SharedValue<number>;
}) {
  const x = city.pixel % MAP_WIDTH;
  const y = Math.floor(city.pixel / MAP_WIDTH);
  const radius = cityInfluenceRadius(world, city);
  const color = world.countries[city.countryId]?.color ?? '#8f3036';
  const hasPort = world.isCoastal(city.pixel) || world.knownRivers[city.pixel] > 0;
  const zoomRank = cityVisibilityRank(city, hasPort);
  const lines = selected ? circleHatchLines(x, y, radius, 8) : [];
  const visible = useDerivedValue(() => {
    const viewScale = scale.value;
    const screenX = ox.value + x * viewScale;
    const screenY = oy.value + y * viewScale;
    const screenRadius = radius * viewScale;
    const inViewport = screenX + screenRadius >= 0 && screenY + screenRadius >= 0 &&
      screenX - screenRadius <= width.value && screenY - screenRadius <= height.value;
    return inViewport && (selected || isCityVisibleAtZoom(viewScale, baseScale.value, zoomRank)) ? 1 : 0;
  });
  return (
    <Group opacity={visible}>
      {selected && <Circle cx={x} cy={y} r={radius} color={color} opacity={0.12} />}
      {lines.map((line, index) => (
        <Line key={index} p1={{ x: line.x1, y: line.y1 }} p2={{ x: line.x2, y: line.y2 }}
          color={color} strokeWidth={1.35} opacity={0.72} />
      ))}
      <Circle cx={x} cy={y} r={radius} style="stroke" color={color}
        strokeWidth={selected ? 2.2 : 0.7 + city.rank * 0.22} opacity={selected ? 0.95 : 0.16 + city.rank * 0.075} />
    </Group>
  );
}

function CityInfluenceLayer({ world, selectedCityId, active, scale, baseScale, ox, oy, width, height }: {
  world: World;
  selectedCityId: number | null;
  active: boolean;
  scale: SharedValue<number>;
  baseScale: SharedValue<number>;
  ox: SharedValue<number>;
  oy: SharedValue<number>;
  width: SharedValue<number>;
  height: SharedValue<number>;
}) {
  if (!active) return null;
  return (
    <>
      {world.cities.map((city) => (
        <CityInfluenceMark key={city.id} city={city} world={world} selected={selectedCityId === city.id}
          scale={scale} baseScale={baseScale} ox={ox} oy={oy} width={width} height={height} />
      ))}
    </>
  );
}

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

/** Карта телефона: холст Skia с перетаскиванием, масштабированием, кистью и осмотром точек. */
export const MapView = forwardRef<MapViewHandle, MapViewProps>(function MapView({ game, tool, canPaint, onInspect, onMapActivity }, ref) {
  const sizeRef = useRef({ width: 1, height: 1 });
  const viewRef = useRef<ViewTransform>({ scale: 1, ox: 0, oy: 0 });
  const laidOut = useRef(false);
  const toolRef = useRef(tool);
  const canPaintRef = useRef(canPaint);
  const inspectRef = useRef(onInspect);
  const activityRef = useRef(onMapActivity);
  toolRef.current = tool;
  canPaintRef.current = canPaint;
  inspectRef.current = onInspect;
  activityRef.current = onMapActivity;

  const scale = useSharedValue(1);
  const markerBaseScale = useSharedValue(1);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const viewportWidth = useSharedValue(1);
  const viewportHeight = useSharedValue(1);
  const cursorX = useSharedValue(0);
  const cursorY = useSharedValue(0);
  const cursorR = useSharedValue(0);
  const cursorOpacity = useSharedValue(0);
  const strips = useMemo(() => Array.from({ length: STRIPS }, () => makeMutable<SkImage | null>(null)), []);

  const transform = useDerivedValue(() => [{ translateX: ox.value }, { translateY: oy.value }, { scale: scale.value }]);
  const sampling = useDerivedValue(() => (scale.value >= 1 ? NEAREST : LINEAR));

  const centerAtPixel = (pixel: number) => {
    const { width, height } = sizeRef.current;
    applyView(centerOnMapPoint(viewRef.current, pixel % MAP_WIDTH, Math.floor(pixel / MAP_WIDTH), width, height));
  };

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
    centerAtPixel,
  }));

  // Цикл перерисовки отрисовывает изменённые строки в пределах кадра и загружает затронутые полосы.
  useEffect(() => {
    let frame: number | null = null;
    let alive = true;
    const pump = () => {
      frame = null;
      if (!alive) return;
      // Карта загружается полосами на всю ширину после отрисовки всех изменённых в них точек.
      for (const s of game.renderer.flushSome(PAINT_BUDGET_MS)) {
        const old = strips[s].value;
        strips[s].value = makeStrip(game.renderer.pixels, s);
        // Копия для графического процессора освобождается после показа новой полосы.
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
    viewportWidth.value = sizeRef.current.width;
    viewportHeight.value = sizeRef.current.height;
    markerBaseScale.value = initialView(sizeRef.current.width, sizeRef.current.height).scale;
    if (!laidOut.current) {
      laidOut.current = true;
      applyView(initialView(sizeRef.current.width, sizeRef.current.height));
    } else applyView(clampView(viewRef.current, sizeRef.current.width, sizeRef.current.height));
  };

  // Координаты касаний относительно карты: из координат страницы вычитается смещение области просмотра.
  const offset = useRef({ x: 0, y: 0 });
  const touches = (event: GestureResponderEvent) =>
    event.nativeEvent.touches.map((t) => ({ id: Number(t.identifier), x: t.pageX - offset.current.x, y: t.pageY - offset.current.y }));
  const onGrant = (event: GestureResponderEvent) => {
    const e = event.nativeEvent;
    offset.current = { x: e.pageX - e.locationX, y: e.pageY - e.locationY };
    activityRef.current?.();
    gestures.sync(touches(event));
  };
  const onTouch = (event: GestureResponderEvent) => {
    activityRef.current?.();
    gestures.sync(touches(event));
  };
  const onRelease = () => gestures.releaseAll();

  return (
    <View style={styles.wrap} onLayout={onLayout}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group transform={transform}>
          {strips.map((image, s) => (
            <SkiaImage key={s} image={image} x={0} y={s * STRIP_H} width={MAP_WIDTH} height={STRIP_H} sampling={sampling} />
          ))}
          <CityInfluenceLayer world={game.world} selectedCityId={game.getSnapshot().selectedCityId} active={game.getSnapshot().mapMode === 'cities'}
            scale={scale} baseScale={markerBaseScale} ox={ox} oy={oy} width={viewportWidth} height={viewportHeight} />
          <MapAnnotations game={game} scale={scale} baseScale={markerBaseScale} ox={ox} oy={oy}
            width={viewportWidth} height={viewportHeight} />
          <CityMarkers world={game.world} scale={scale} baseScale={markerBaseScale} mapPixels={game.renderer.pixels} />
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
