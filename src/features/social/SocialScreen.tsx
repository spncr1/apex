import { UsersRound } from 'lucide-react-native';
import { StyleSheet, Text, View } from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { colors, radii, spacing, typography } from '../../theme/tokens';

export function SocialScreen() {
  return (
    <ScreenFrame
      eyebrow="COMMUNITY"
      title="Social"
      subtitle="Your training community, all in one place."
    >
      <View style={styles.card}>
        <UsersRound size={42} color={colors.accent} />
        <Text style={styles.heading}>In Development</Text>
        <Text style={styles.detail}>Social features are on the way.</Text>
      </View>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 250,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  heading: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.title,
  },
  detail: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    textAlign: 'center',
  },
});
