import { ChevronLeft, LogOut } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApexBrand } from '../../components/ApexBrand';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import { useAuth } from './AuthProvider';

export function AccountScreen() {
  const router = useRouter();
  const { session, status, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const signOutError = await signOut();
      if (signOutError) setError(signOutError);
    } catch {
      setError('Could not sign out. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <Pressable
          onPress={() => router.back()}
          style={styles.backButton}
          accessibilityRole="button"
          accessibilityLabel="Back to dashboard"
        >
          <ChevronLeft size={23} color={colors.textPrimary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
        <ApexBrand />

        <View style={styles.card}>
          <Text style={styles.heading}>
            {status === 'offline' ? 'You’re offline.' : 'You’re signed in.'}
          </Text>
          <Text style={styles.detail}>
            {status === 'offline'
              ? 'Connect to refresh your sign-in.'
              : session?.user.email}
          </Text>

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          <Pressable
            style={({ pressed }) => [
              styles.signOutButton,
              pressed && styles.pressed,
            ]}
            onPress={() => void handleSignOut()}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
            accessibilityState={{ disabled: busy }}
          >
            <LogOut size={20} color={colors.textPrimary} />
            <Text style={styles.signOutText}>
              {busy ? 'Signing out…' : 'Sign out'}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.xl, paddingTop: spacing.lg },
  backButton: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.xl,
    zIndex: 1,
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  backText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  card: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xl,
  },
  heading: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.title,
    marginBottom: spacing.sm,
  },
  detail: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    marginBottom: spacing.xl,
  },
  error: {
    color: colors.danger,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    marginBottom: spacing.lg,
  },
  signOutButton: {
    minHeight: sizing.touchTarget,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  signOutText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  pressed: { opacity: 0.8 },
});
