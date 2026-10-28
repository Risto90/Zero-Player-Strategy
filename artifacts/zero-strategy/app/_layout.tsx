import React, { useEffect, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StyleSheet, View } from 'react-native';
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { PlayfairDisplay_400Regular, PlayfairDisplay_400Regular_Italic, PlayfairDisplay_700Bold, useFonts } from '@expo-google-fonts/playfair-display';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import colors from '@/constants/colors';
import { currentGame, subscribeGameSession } from '@/game/session';
import type { Game } from '@/game/game';
import { useGameSnapshot } from '@/game/useGame';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [game, setGame] = useState<Game | null>(() => currentGame());
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    JetBrainsMono_500Medium,
    PlayfairDisplay_400Regular,
    PlayfairDisplay_400Regular_Italic,
    PlayfairDisplay_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) SplashScreen.hideAsync();
  }, [fontsLoaded, fontError]);

  useEffect(() => subscribeGameSession(() => setGame(currentGame())), []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <View style={styles.root}>
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.light.background } }}>
            <Stack.Screen name="index" />
            <Stack.Screen name="play" options={{ gestureEnabled: false, freezeOnBlur: false }} />
            <Stack.Screen name="country/[id]" />
            <Stack.Screen name="country/[id]/candidates" />
            <Stack.Screen name="country/[id]/rulers" />
            <Stack.Screen name="city/[id]" />
            <Stack.Screen name="culture/[id]" />
            <Stack.Screen name="religion/[id]" />
            <Stack.Screen name="race/[id]" />
            <Stack.Screen name="person/[id]" />
          </Stack>
          {game && <OffscreenTurnAlert game={game} />}
        </View>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function OffscreenTurnAlert({ game }: { game: Game }) {
  const snapshot = useGameSnapshot(game);
  if (!snapshot.offscreenTurnAlert) return null;
  return (
    <View
      pointerEvents="none"
      accessibilityLabel="Ход поставлен на паузу до возвращения на карту"
      style={styles.alertFrame}
    >
      <View style={[styles.alertEdge, styles.alertTop]} />
      <View style={[styles.alertEdge, styles.alertBottom]} />
      <View style={[styles.alertEdge, styles.alertLeft]} />
      <View style={[styles.alertEdge, styles.alertRight]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  alertFrame: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 1000, elevation: 1000 },
  alertEdge: { position: 'absolute', backgroundColor: 'rgba(177, 31, 31, 0.45)' },
  alertTop: { top: 0, left: 0, right: 0, height: 12 },
  alertBottom: { bottom: 0, left: 0, right: 0, height: 12 },
  alertLeft: { top: 0, bottom: 0, left: 0, width: 12 },
  alertRight: { top: 0, bottom: 0, right: 0, width: 12 },
});
