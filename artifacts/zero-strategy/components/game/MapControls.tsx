import { Feather, MaterialCommunityIcons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { MapTool } from '@/components/map/types';
import colors, { fonts } from '@/constants/colors';
import { BRUSH_SIZES } from '@/game/config';
import type { Game, GameSnapshot } from '@/game/game';

const c = colors.light;

export function MapControls({
  game,
  snap,
  tool,
  setTool,
  onZoom,
  onFit,
}: {
  game: Game;
  snap: GameSnapshot;
  tool: MapTool;
  setTool: (t: MapTool) => void;
  onZoom: (f: number) => void;
  onFit: () => void;
}) {
  const optionLabel =
    snap.brushOption === 'density'
      ? snap.brushMode === 'repeat' ? 'Повтор: +население на своей земле' : 'Каждая точка — один раз'
      : snap.brushMode === 'repeat' ? 'Каждый мазок действует снова' : 'Каждая точка — один раз';
  const brushOn = tool === 'brush';
  return (
    <>
      <View style={styles.left} pointerEvents="box-none">
        <View style={styles.segment}>
          <Pressable onPress={() => setTool('brush')} style={[styles.segButton, brushOn && styles.segOn]} testID="button-tool-brush">
            <MaterialCommunityIcons name="brush" size={16} color={brushOn ? c.background : c.foreground} />
            <Text style={[styles.segText, brushOn && { color: c.background }]}>Кисть</Text>
          </Pressable>
          <Pressable onPress={() => setTool('hand')} style={[styles.segButton, styles.segDivider, !brushOn && styles.segOn]} testID="button-tool-hand">
            <MaterialCommunityIcons name="hand-back-right-outline" size={16} color={!brushOn ? c.background : c.foreground} />
            <Text style={[styles.segText, !brushOn && { color: c.background }]}>Рука</Text>
          </Pressable>
        </View>
        {brushOn && (
          <View style={styles.segment}>
            {BRUSH_SIZES.map((s, i) => {
              const on = snap.brushSize === s.id;
              return (
                <Pressable key={s.id} onPress={() => game.setBrushSize(s.id)} style={[styles.size, i > 0 && styles.segDivider, on && { backgroundColor: c.primary }]} testID={`button-size-${s.id}`}>
                  <Text style={[styles.sizeText, on && { color: c.primaryForeground }]}>{s.label}</Text>
                </Pressable>
              );
            })}
          </View>
        )}
        {brushOn && snap.brushOption !== null && (
          <Pressable
            onPress={() => game.toggleBrushMode()}
            style={[styles.option, snap.brushMode === 'repeat' && { backgroundColor: c.accent }]}
            testID="button-brush-mode"
          >
            <MaterialCommunityIcons name={snap.brushMode === 'repeat' ? 'repeat' : 'repeat-once'} size={16} color={snap.brushMode === 'repeat' ? c.accentForeground : c.foreground} />
            <Text style={[styles.optionText, snap.brushMode === 'repeat' && { color: c.accentForeground }]}>{optionLabel}</Text>
          </Pressable>
        )}
        {brushOn && !snap.canPaint && (
          <Text style={styles.hint}>Рисовать нечем — сдвигайте карту</Text>
        )}
      </View>
      <View style={styles.right} pointerEvents="box-none">
        <Pressable style={styles.zoom} onPress={() => onZoom(1.5)} accessibilityLabel="Приблизить" testID="button-zoom-in">
          <Feather name="plus" size={18} color={c.foreground} />
        </Pressable>
        <Pressable style={styles.zoom} onPress={() => onZoom(1 / 1.5)} accessibilityLabel="Отдалить" testID="button-zoom-out">
          <Feather name="minus" size={18} color={c.foreground} />
        </Pressable>
        <Pressable style={styles.zoom} onPress={onFit} accessibilityLabel="Весь мир" testID="button-zoom-fit">
          <Feather name="maximize" size={16} color={c.foreground} />
        </Pressable>
      </View>
    </>
  );
}

const shadow = { shadowColor: '#2c1e17', shadowOpacity: 0.18, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 3 };

const styles = StyleSheet.create({
  left: { position: 'absolute', left: 8, top: 8, alignItems: 'flex-start', gap: 6 },
  right: { position: 'absolute', right: 8, top: 8, gap: 6 },
  segment: { flexDirection: 'row', borderWidth: 1, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.card, overflow: 'hidden', ...shadow },
  segButton: { height: 40, flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10 },
  segDivider: { borderLeftWidth: 1, borderLeftColor: c.foreground },
  segOn: { backgroundColor: c.foreground },
  segText: { fontFamily: fonts.sansSemiBold, fontSize: 12, color: c.foreground },
  size: { width: 38, height: 36, alignItems: 'center', justifyContent: 'center' },
  sizeText: { fontFamily: fonts.mono, fontSize: 12, color: c.foreground },
  option: { maxWidth: 200, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.card, paddingHorizontal: 8, paddingVertical: 6, ...shadow },
  optionText: { flexShrink: 1, fontFamily: fonts.sansMedium, fontSize: 11, lineHeight: 14, color: c.foreground },
  hint: { backgroundColor: 'rgba(59,43,33,0.9)', color: c.secondaryForeground, fontFamily: fonts.sans, fontSize: 11, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4, overflow: 'hidden' },
  zoom: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: c.foreground, borderRadius: 4, backgroundColor: c.card, ...shadow },
});
