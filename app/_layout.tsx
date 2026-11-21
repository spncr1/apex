import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { useFonts } from 'expo-font';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { DesktopSidebar } from '../src/components/DesktopSidebar';
import { AuthProvider, useAuth } from '../src/features/auth/AuthProvider';
import { useDesktopLayout } from '../src/theme/useDesktopLayout';
import { colors } from '../src/theme/tokens';

function AppRoutes() {
  const { status } = useAuth();
  const desktop = useDesktopLayout();

  if (status === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.accent} />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <View style={styles.shell}>
      {desktop && (status === 'signed_in' || status === 'offline') && (
        <DesktopSidebar />
      )}
      <View style={styles.main}>
        <Stack screenOptions={{ headerShown: false }}>
          <Stack.Protected guard={status === 'signed_out'}>
            <Stack.Screen name="sign-in" />
          </Stack.Protected>
          <Stack.Protected
            guard={status === 'signed_in' || status === 'offline'}
          >
            <Stack.Screen name="index" />
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="account" />
            <Stack.Screen name="session/[id]" />
            <Stack.Screen name="session/exercise/[id]" />
            <Stack.Screen name="conflicts" />
          </Stack.Protected>
        </Stack>
      </View>
      <StatusBar style="light" />
    </View>
  );
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_600SemiBold });

  if (!fontsLoaded) return null;

  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  shell: { flex: 1, flexDirection: 'row', backgroundColor: colors.background },
  main: { flex: 1, minWidth: 0 },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
});
