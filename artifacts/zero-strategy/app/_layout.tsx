import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { PlayfairDisplay_400Regular, PlayfairDisplay_400Regular_Italic, PlayfairDisplay_700Bold, useFonts } from '@expo-google-fonts/playfair-display';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import colors from '@/constants/colors';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
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

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.light.background } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="play" options={{ gestureEnabled: false }} />
          <Stack.Screen name="country/[id]" />
          <Stack.Screen name="country/[id]/candidates" />
          <Stack.Screen name="country/[id]/rulers" />
          <Stack.Screen name="city/[id]" />
          <Stack.Screen name="culture/[id]" />
          <Stack.Screen name="religion/[id]" />
          <Stack.Screen name="person/[id]" />
        </Stack>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
