import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ApexBrand } from '../../components/ApexBrand';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import { useAuth } from './AuthProvider';

type FormMode = 'sign_in' | 'sign_up';

export function SignInScreen() {
  const { configurationMissing, signIn, signUp } = useAuth();
  const [mode, setMode] = useState<FormMode>('sign_in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const creatingAccount = mode === 'sign_up';

  async function submit() {
    if (busy) return;
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }

    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      if (creatingAccount) {
        const result = await signUp(email, password);
        if (result.error) {
          setError(result.error);
        } else if (result.confirmationRequired) {
          setMode('sign_in');
          setPassword('');
          setMessage('Check your email to confirm your account, then sign in.');
        }
      } else {
        const signInError = await signIn(email, password);
        if (signInError) setError(signInError);
      }
    } catch {
      setError('Could not connect. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  function switchMode() {
    setMode(creatingAccount ? 'sign_in' : 'sign_up');
    setPassword('');
    setError(null);
    setMessage(null);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <ApexBrand />

          <Text style={styles.heading}>
            {creatingAccount ? 'Start training.' : 'Welcome back.'}
          </Text>
          <Text style={styles.subheading}>
            {creatingAccount
              ? 'Create an account to keep your workouts together.'
              : 'Sign in to your training space.'}
          </Text>

          <View style={styles.card}>
            <Text style={styles.label}>Email</Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="you@example.com"
              placeholderTextColor={colors.textMuted}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              accessibilityLabel="Email"
              editable={!busy}
            />

            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              placeholder="Enter password"
              placeholderTextColor={colors.textMuted}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={
                creatingAccount ? 'new-password' : 'current-password'
              }
              textContentType={creatingAccount ? 'newPassword' : 'password'}
              accessibilityLabel="Password"
              editable={!busy}
              onSubmitEditing={() => void submit()}
            />

            {configurationMissing ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                Supabase is not configured on this device.
              </Text>
            ) : null}
            {error ? (
              <Text style={styles.error} accessibilityLiveRegion="polite">
                {error}
              </Text>
            ) : null}
            {message ? (
              <Text style={styles.message} accessibilityLiveRegion="polite">
                {message}
              </Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.submitButton,
                pressed && styles.pressed,
              ]}
              onPress={() => void submit()}
              disabled={busy || configurationMissing}
              accessibilityRole="button"
              accessibilityLabel={
                creatingAccount ? 'Create account' : 'Sign in'
              }
              accessibilityState={{ disabled: busy || configurationMissing }}
            >
              {busy ? (
                <ActivityIndicator color={colors.textOnAccent} />
              ) : (
                <Text style={styles.submitText}>
                  {creatingAccount ? 'Create account' : 'Sign in'}
                </Text>
              )}
            </Pressable>
          </View>

          <Pressable
            style={styles.modeButton}
            onPress={switchMode}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.modeText}>
              {creatingAccount ? 'Already have an account? ' : 'New here? '}
              <Text style={styles.modeLink}>
                {creatingAccount ? 'Sign in' : 'Create account'}
              </Text>
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  keyboardArea: { flex: 1 },
  content: {
    flexGrow: 1,
    padding: spacing.xl,
    paddingTop: spacing.lg,
  },
  heading: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.hero,
    marginBottom: spacing.sm,
  },
  subheading: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    marginBottom: spacing.xxl,
  },
  card: {
    padding: spacing.xl,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  label: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: sizing.touchTarget,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
    color: colors.textPrimary,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    marginBottom: spacing.xl,
  },
  error: {
    color: colors.danger,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    marginBottom: spacing.lg,
  },
  message: {
    color: colors.success,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    marginBottom: spacing.lg,
  },
  submitButton: {
    minHeight: sizing.touchTarget,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  submitText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  pressed: { opacity: 0.8 },
  modeButton: {
    minHeight: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  modeText: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    textAlign: 'center',
  },
  modeLink: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
  },
});
