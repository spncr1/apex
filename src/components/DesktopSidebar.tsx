import { usePathname, useRouter } from 'expo-router';
import {
  CalendarDays,
  ChartNoAxesCombined,
  Dumbbell,
  House,
  UserRound,
  UsersRound,
} from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../features/auth/AuthProvider';
import { colors, radii, spacing, typography } from '../theme/tokens';
import { ApexLogo } from './ApexLogo';

const links = [
  { label: 'Home', path: '/', icon: House },
  { label: 'Plan', path: '/plan', icon: CalendarDays },
  { label: 'Exercises', path: '/exercises', icon: Dumbbell },
  { label: 'Progress', path: '/progress', icon: ChartNoAxesCombined },
  { label: 'Social', path: '/social', icon: UsersRound },
] as const;

export function DesktopSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { session } = useAuth();
  const email = session?.user.email;

  return (
    <View style={styles.sidebar}>
      <View style={styles.brand}>
        <ApexLogo height={72} />
        <Text style={styles.tagline}>TRAIN / LOG / PROGRESS</Text>
      </View>
      <View style={styles.links}>
        {links.map(({ label, path, icon: Icon }) => {
          const selected =
            path === '/' ? pathname === '/' : pathname.startsWith(path);
          return (
            <Pressable
              key={path}
              onPress={() => router.navigate(path)}
              style={({ hovered }) => [
                styles.link,
                selected && styles.selected,
                hovered && !selected && styles.hovered,
              ]}
              accessibilityRole="link"
              accessibilityState={{ selected }}
              accessibilityLabel={label}
            >
              <Icon
                size={23}
                color={selected ? colors.textOnAccent : colors.textPrimary}
              />
              <Text style={[styles.linkText, selected && styles.selectedText]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Pressable
        onPress={() => router.push('/account')}
        style={({ hovered }) => [
          styles.profile,
          pathname === '/account' && styles.profileSelected,
          hovered && styles.hovered,
        ]}
        accessibilityRole="button"
        accessibilityLabel="Open account"
      >
        <View style={styles.profileIcon}>
          <UserRound size={22} color={colors.textPrimary} />
        </View>
        <View style={styles.profileText}>
          <Text style={styles.profileTitle}>Account</Text>
          <Text style={styles.profileEmail} numberOfLines={1}>
            {email ?? 'Offline account'}
          </Text>
        </View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  sidebar: {
    width: 236,
    flexShrink: 0,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xxl,
    paddingBottom: spacing.xl,
  },
  brand: { alignItems: 'center', marginBottom: 48 },
  tagline: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
    fontSize: 10,
    letterSpacing: 1.4,
  },
  links: { gap: spacing.sm },
  link: {
    minHeight: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  selected: { backgroundColor: colors.accent },
  hovered: { backgroundColor: colors.surfaceElevated },
  linkText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  selectedText: { color: colors.textOnAccent },
  profile: {
    marginTop: 'auto',
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingTop: spacing.lg,
    borderRadius: radii.sm,
  },
  profileSelected: { backgroundColor: colors.surfaceElevated },
  profileIcon: {
    width: 42,
    height: 42,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileText: { flex: 1, minWidth: 0 },
  profileTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  profileEmail: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: 11,
  },
});
