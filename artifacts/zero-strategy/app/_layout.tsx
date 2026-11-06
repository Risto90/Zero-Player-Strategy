import React, { useEffect, useRef, useState } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Text, View } from 'react-native';
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold } from '@expo-google-fonts/ibm-plex-sans';
import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { PlayfairDisplay_400Regular, PlayfairDisplay_400Regular_Italic, PlayfairDisplay_700Bold, useFonts } from '@expo-google-fonts/playfair-display';
import { router, Stack, usePathname } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Loading } from '@/components/Loading';
import colors from '@/constants/colors';
import { initializeDiagnosticLogging, recordDiagnosticError } from '../diagnosticLogger';
import { initializeBrowserBinaryMathKernel } from '../kernel/browser-init';
import { continueSavedGame, currentGame, leaveGame } from '@/game/session';

initializeDiagnosticLogging();
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
  const [kernelReady, setKernelReady] = useState(false);
  const [kernelError, setKernelError] = useState<string | null>(null);

  useEffect(() => {
    initializeBrowserBinaryMathKernel()
      .then(() => setKernelReady(true))
      .catch((error: unknown) => {
        const failure = error instanceof Error ? error : new Error(String(error));
        recordDiagnosticError(failure, failure.stack ?? failure.message);
        setKernelError(failure.message);
      });
  }, []);

  useEffect(() => {
    if ((fontsLoaded || fontError) && (kernelReady || kernelError)) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError, kernelReady, kernelError]);

  if (kernelError) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', padding: 24, backgroundColor: colors.light.background }}>
        <Text style={{ color: colors.light.text, fontFamily: 'IBMPlexSans_500Medium', fontSize: 16 }}>
          Не удалось запустить бинарное математическое ядро: {kernelError}
        </Text>
      </View>
    );
  }
  if (!fontsLoaded && !fontError || !kernelReady) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary onError={recordDiagnosticError}>
        <GameRouteGate />
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}

function GameRouteGate() {
  const pathname = usePathname();
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const [ready, setReady] = useState(() => pathname === '/' || currentGame() !== null);
  const [game, setGame] = useState(() => currentGame());
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;
    if (pathname === '/') {
      setReady(true);
      setLoadError('');
      const existing = currentGame();
      setGame(existing);
      if (existing) void leaveGame();
      return () => {
        active = false;
      };
    }

    const existing = currentGame();
    if (existing) {
      existing.start();
      setGame(existing);
      setLoadError('');
      setReady(true);
      return () => {
        active = false;
      };
    }

    setReady(false);
    setLoadError('');
    void continueSavedGame()
      .then((restored) => {
        if (!active) {
          if (currentPath.current === '/' && restored) {
            restored.stop();
            void restored.saveNow();
          }
          return;
        }
        setGame(restored);
        setReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : String(error));
        setReady(true);
      });
    return () => {
      active = false;
    };
  }, [pathname]);

  useEffect(() => {
    if (!game) return;
    const saveWhenHidden = () => {
      if (document.visibilityState === 'hidden') void game.saveNow();
    };
    const saveBeforeExit = () => void game.saveNow();
    document.addEventListener('visibilitychange', saveWhenHidden);
    window.addEventListener('pagehide', saveBeforeExit);
    return () => {
      document.removeEventListener('visibilitychange', saveWhenHidden);
      window.removeEventListener('pagehide', saveBeforeExit);
    };
  }, [game]);

  if (!ready) return <Loading text="Восстанавливаем сохранённую игру…" />;
  if (loadError) {
    return (
      <Loading
        text="Не удалось открыть игру"
        error={loadError}
        onBack={() => router.replace('/')}
      />
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.light.background } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="play" options={{ gestureEnabled: false }} />
      <Stack.Screen name="country/[id]" />
      <Stack.Screen name="country/[id]/candidates" />
      <Stack.Screen name="country/[id]/rulers" />
      <Stack.Screen name="city/[id]" />
      <Stack.Screen name="culture/[id]" />
      <Stack.Screen name="religion/[id]" />
      <Stack.Screen name="race/[id]" />
      <Stack.Screen name="person/[id]" />
    </Stack>
  );
}
