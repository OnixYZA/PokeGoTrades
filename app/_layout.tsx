import '../global.css';

import { JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono/500Medium';
import { JetBrainsMono_600SemiBold } from '@expo-google-fonts/jetbrains-mono/600SemiBold';
import { JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono/700Bold';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_600SemiBold } from '@expo-google-fonts/space-grotesk/600SemiBold';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import Head from 'expo-router/head';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { ToastHost } from '@/components/ui/ToastHost';
import { LiveSync } from '@/lib/live-sync';
import { SessionProvider, useSession } from '@/lib/session';

export { ErrorBoundary } from 'expo-router';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <SessionProvider>
          <RootNavigator />
        </SessionProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function RootNavigator() {
  const { isLoading: sessionLoading } = useSession();
  const [loaded, error] = useFonts({
    SpaceGrotesk_500Medium,
    SpaceGrotesk_600SemiBold,
    SpaceGrotesk_700Bold,
    JetBrainsMono_500Medium,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_700Bold,
  });

  useEffect(() => {
    if (error) throw error;
  }, [error]);

  // The splash stays up until fonts AND the stored/anonymous session have resolved.
  const ready = loaded && !sessionLoading;

  useEffect(() => {
    if (ready) {
      SplashScreen.hide();
    }
  }, [ready]);

  if (!ready) {
    return null;
  }

  return (
    <>
      <LiveSync />
      <StatusBar style="light" />
      <Head>
        <title>PokeGoTrades</title>
        <meta name="description" content="Trade Pokemon easily in your local area." />
      </Head>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#050810' } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen
          name="listing/[id]"
          options={{ presentation: 'transparentModal', animation: 'none' }}
        />
        <Stack.Screen name="profile/[userId]" />
        <Stack.Screen name="onboarding" />
        <Stack.Screen
          name="test-bail"
          options={{ presentation: 'transparentModal', animation: 'fade' }}
        />
      </Stack>
      <ToastHost />
    </>
  );
}
