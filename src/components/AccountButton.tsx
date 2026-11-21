import { useRouter } from 'expo-router';
import { UserRound } from 'lucide-react-native';
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radii, sizing, spacing } from '../theme/tokens';
import { useDesktopLayout } from '../theme/useDesktopLayout';

export function AccountButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const desktop = useDesktopLayout();
  if (desktop) return null;

  return (
    <Pressable
      onPress={() => router.push('/account')}
      style={[styles.accountButton, style]}
      accessibilityRole="button"
      accessibilityLabel="Open account"
    >
      <UserRound size={24} color={colors.textPrimary} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  accountButton: {
    position: 'absolute',
    top: spacing.sm,
    right: 0,
    zIndex: 1,
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
  },
});
