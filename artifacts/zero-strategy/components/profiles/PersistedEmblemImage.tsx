import { createElement, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import { SvgXml } from 'react-native-svg';

/** Показывает SVG, уже созданный и сохранённый вместе с эмблемой. */
export function PersistedEmblemImage({ svg, label, width, height, testID }: {
  svg: string;
  label: string;
  width: number | string;
  height: number | string;
  testID?: string;
}) {
  const [failedImageUri, setFailedImageUri] = useState<string | null>(null);
  const imageUri = useMemo(
    () => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`,
    [svg],
  );
  if (Platform.OS === 'web' && failedImageUri !== imageUri) {
    return createElement('img', {
      src: imageUri,
      alt: label,
      draggable: true,
      'data-testid': testID,
      onError: () => setFailedImageUri(imageUri),
      style: { display: 'block', width, height, objectFit: 'contain' },
    });
  }
  return <SvgXml xml={svg} width={width} height={height} accessibilityLabel={label} testID={testID} />;
}
