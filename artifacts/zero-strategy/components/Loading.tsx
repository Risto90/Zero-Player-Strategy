import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';

const c = colors.light;

export function Loading({
  text,
  error,
  onRetry,
  onBack,
}: {
  text: string;
  error?: string;
  onRetry?: () => void;
  onBack?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      {!error && <ActivityIndicator size="large" color={c.primary} />}
      <Text style={styles.text}>{text}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {error && onRetry && (
        <Pressable onPress={onRetry} style={styles.action} testID="button-retry-start">
          <Text style={styles.actionText}>Повторить</Text>
        </Pressable>
      )}
      {error && onBack && (
        <Pressable onPress={onBack} style={styles.backAction} testID="button-back-start">
          <Text style={styles.backText}>Вернуться к выбору</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, gap: 16, paddingHorizontal: 24 },
  text: { fontFamily: fonts.displayItalic, fontSize: 20, color: c.foreground },
  error: { maxWidth: 420, textAlign: 'center', fontFamily: fonts.sans, fontSize: 14, lineHeight: 21, color: c.destructive },
  action: { minWidth: 180, alignItems: 'center', backgroundColor: c.primary, borderRadius: colors.radius, paddingHorizontal: 18, paddingVertical: 13 },
  actionText: { fontFamily: fonts.sansSemiBold, fontSize: 15, color: c.primaryForeground },
  backAction: { paddingHorizontal: 18, paddingVertical: 10 },
  backText: { fontFamily: fonts.sans, fontSize: 14, color: c.mutedForeground },
});
