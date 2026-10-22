import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import colors, { fonts } from '@/constants/colors';

const c = colors.light;

export function Loading({ text }: { text: string }) {
  return (
    <View style={styles.wrap}>
      <ActivityIndicator size="large" color={c.primary} />
      <Text style={styles.text}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.background, gap: 16 },
  text: { fontFamily: fonts.displayItalic, fontSize: 20, color: c.foreground },
});
