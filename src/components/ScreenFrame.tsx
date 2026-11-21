import type { ReactNode } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, spacing, typography } from '../theme/tokens';
import { useDesktopLayout } from '../theme/useDesktopLayout';
import { AccountButton } from './AccountButton';
import { ApexBrand } from './ApexBrand';

export function ScreenFrame({
  eyebrow,
  title,
  subtitle,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  const desktop = useDesktopLayout();
  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          desktop && styles.desktopContent,
        ]}
      >
        {!desktop && <ApexBrand />}
        <AccountButton style={styles.accountButton} />
        <View style={styles.eyebrowRow}>
          <View style={styles.eyebrowMark} />
          <Text style={styles.eyebrow}>{eyebrow}</Text>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle}>{subtitle}</Text>
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: {
    width: '100%',
    padding: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: 120,
  },
  accountButton: { right: spacing.lg },
  desktopContent: {
    maxWidth: 1220,
    alignSelf: 'center',
    paddingHorizontal: spacing.xxl,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xxl,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  eyebrowMark: {
    width: 5,
    height: 20,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  eyebrow: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
    letterSpacing: 2,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.hero,
    marginTop: spacing.sm,
  },
  subtitle: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    marginTop: spacing.xs,
    marginBottom: spacing.xxl,
  },
});
