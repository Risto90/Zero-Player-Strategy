import { Text, View } from 'react-native';
import type { FlagSpec } from '@/game/flagSpec';
import colors, { fonts } from '@/constants/colors';
import { PersistedEmblemImage } from './PersistedEmblemImage';

export function EmblemPreview({
  spec,
  svg,
  label,
  shape = 'flag',
  showLabel = false,
  frameHeight,
}: {
  spec?: FlagSpec;
  svg?: string;
  label: string;
  shape?: 'flag' | 'coat';
  showLabel?: boolean;
  frameHeight?: number;
}) {
  if (!spec || !svg) return null;
  const ratio = shape === 'coat' ? 1 : Math.max(0.6, Math.min(2.6, spec.outline.aspect));
  return (
    <View style={[styles.container, !frameHeight && styles.fullWidth]} accessibilityLabel={label}>
      <View style={[styles.image, {
        ...(frameHeight ? { width: frameHeight * ratio, height: frameHeight } : { aspectRatio: ratio }),
        maxWidth: shape === 'coat' ? 120 : 144,
        maxHeight: frameHeight ?? 84,
      }]}>
        <PersistedEmblemImage svg={svg} label={label} width="100%" height="100%" testID="profile-emblem-image" />
      </View>
      {showLabel ? <Text style={styles.caption}>{label}</Text> : null}
    </View>
  );
}

const styles = {
  container: { alignItems: 'flex-start' as const, gap: 5 },
  fullWidth: { width: '100%' as const },
  image: {
    width: '100%' as const,
    overflow: 'hidden' as const,
  },
  caption: { fontFamily: fonts.sans, fontSize: 11, color: colors.light.mutedForeground } as const,
};
