import { createElement, useMemo, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { SvgXml } from 'react-native-svg';
import { renderFlagSpec } from '@/game/flagRenderer';
import type { FlagSpec } from '@/game/flagSpec';
import colors, { fonts } from '@/constants/colors';

export function EmblemPreview({
  spec,
  label,
  shape = 'flag',
  showLabel = false,
  frameHeight,
}: {
  spec?: FlagSpec;
  label: string;
  shape?: 'flag' | 'coat';
  showLabel?: boolean;
  frameHeight?: number;
}) {
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);
  const svg = useMemo(() => spec ? renderFlagSpec(spec) : null, [spec]);
  const imageUri = useMemo(
    () => svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` : null,
    [svg],
  );
  if (!spec || !imageUri) return null;
  const ratio = shape === 'coat' ? 1 : Math.max(0.6, Math.min(2.6, spec.outline.aspect));
  const image = Platform.OS === 'web' && failedImageUri !== imageUri
    ? createElement('img', {
      src: imageUri,
      alt: label,
      draggable: true,
      'data-testid': 'profile-emblem-image',
      onError: () => setFailedImageUri(imageUri),
      style: { display: 'block', width: '100%', height: '100%', objectFit: 'contain' },
    })
    : <SvgXml xml={svg} width="100%" height="100%" accessibilityLabel={label} />;
  return (
    <View style={[styles.container, !frameHeight && styles.fullWidth]} accessibilityLabel={label}>
      <View style={[styles.frame, {
        ...(frameHeight ? { width: frameHeight * ratio, height: frameHeight } : { aspectRatio: ratio }),
        maxWidth: shape === 'coat' ? 120 : 144,
        maxHeight: frameHeight ?? 84,
      }]}>
        {image}
      </View>
      {showLabel ? <Text style={styles.caption}>{label}</Text> : null}
    </View>
  );
}

const styles = {
  container: { alignItems: 'flex-start' as const, gap: 5, paddingVertical: 2 },
  fullWidth: { width: '100%' as const },
  frame: {
    width: '100%' as const,
    overflow: 'hidden' as const,
    borderWidth: 1,
    borderColor: colors.light.border,
    backgroundColor: colors.light.card,
  },
  caption: { fontFamily: fonts.sans, fontSize: 11, color: colors.light.mutedForeground } as const,
};
