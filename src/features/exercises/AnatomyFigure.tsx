import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import bodyPaths from '../../../assets/anatomy/anatome-body-paths.json';
import { colors, radii, spacing, typography } from '../../theme/tokens';

type BodyView = 'front' | 'back';
type AnatomyPath = {
  slug: string;
  path: { left?: string[]; right?: string[] };
};

const groupRegions: Record<string, { view: BodyView; slugs: string[] }> = {
  abdominals: { view: 'front', slugs: ['abs', 'obliques'] },
  biceps: { view: 'front', slugs: ['biceps'] },
  calves: { view: 'back', slugs: ['calves'] },
  chest: { view: 'front', slugs: ['chest'] },
  forearms: { view: 'front', slugs: ['forearm'] },
  glutes: { view: 'back', slugs: ['gluteal'] },
  hamstrings: { view: 'back', slugs: ['hamstring'] },
  lats: { view: 'back', slugs: ['upper-back'] },
  quadriceps: { view: 'front', slugs: ['quadriceps'] },
  shoulders: { view: 'front', slugs: ['deltoids'] },
  triceps: { view: 'front', slugs: ['triceps'] },
};

export function anatomyRegionFor(name: string) {
  return groupRegions[name.trim().toLocaleLowerCase()] ?? null;
}

export function AnatomyFigure({
  groupName,
  selectedSlug,
  interactiveSlugs,
  onSelectSlug,
}: {
  groupName: string;
  selectedSlug: string | null;
  interactiveSlugs: string[];
  onSelectSlug: (slug: string | null) => void;
}) {
  const region = anatomyRegionFor(groupName);
  const paths = useMemo(
    () => (region ? (bodyPaths.data.male[region.view] as AnatomyPath[]) : []),
    [region],
  );
  if (!region) return null;

  return (
    <View style={styles.card}>
      <Svg
        viewBox="60 120 604 1208"
        width="100%"
        height={320}
        accessibilityLabel={`${groupName} anatomy`}
      >
        {paths.flatMap((part) =>
          [...(part.path.left ?? []), ...(part.path.right ?? [])].map(
            (path, index) => (
              <Path
                key={`${part.slug}-${index}`}
                d={path}
                fill={
                  region.slugs.includes(part.slug) &&
                  (!selectedSlug || selectedSlug === part.slug)
                    ? colors.accent
                    : colors.surfaceElevated
                }
                stroke={colors.background}
                strokeWidth={2}
                onPress={
                  interactiveSlugs.includes(part.slug)
                    ? () =>
                        onSelectSlug(
                          selectedSlug === part.slug ? null : part.slug,
                        )
                    : undefined
                }
              />
            ),
          ),
        )}
      </Svg>
      <Text style={styles.caption}>
        {interactiveSlugs.length
          ? 'Tap a highlighted region to filter exercises.'
          : ''}
      </Text>
      {selectedSlug ? (
        <Pressable
          style={styles.clear}
          onPress={() => onSelectSlug(null)}
          accessibilityRole="button"
        >
          <Text style={styles.clearText}>Clear region</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '100%',
    minWidth: 0,
    alignItems: 'center',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.xl,
  },
  caption: {
    width: '100%',
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    textAlign: 'center',
  },
  clear: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  clearText: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
});
