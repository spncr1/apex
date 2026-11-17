import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import bodyPaths from '../../../assets/anatomy/anatome-body-paths.json';
import { colors, radii, spacing, typography } from '../../theme/tokens';

type BodyView = 'front' | 'back';

const viewBoxes: Record<BodyView, string> = {
  front: '60 120 604 1208',
  back: '795 120 604 1208',
};
type AnatomyPath = {
  slug: string;
  path: { left?: string[]; right?: string[] };
};

type GroupRegion = { front?: readonly string[]; back?: readonly string[] };

const groupRegions: Record<string, GroupRegion> = {
  abs: { front: ['abs', 'obliques'] },
  back: { back: ['upper-back', 'lower-back', 'trapezius'] },
  biceps: { front: ['biceps'] },
  calves: { back: ['calves'] },
  chest: { front: ['chest'] },
  forearms: { front: ['forearm'] },
  glutes: { back: ['gluteal'] },
  hamstrings: { back: ['hamstring'] },
  lats: { back: ['upper-back'] },
  legs: {
    front: ['quadriceps', 'adductors', 'tibialis'],
    back: ['hamstring', 'calves', 'gluteal', 'adductors'],
  },
  'lower back': { back: ['lower-back'] },
  quadriceps: { front: ['quadriceps'] },
  shoulders: { front: ['deltoids'] },
  triceps: { front: ['triceps'] },
  'upper back': { back: ['upper-back', 'trapezius'] },
};

const groupAliases: Record<string, string> = {
  abdominal: 'abs',
  abdominals: 'abs',
  core: 'abs',
  bicep: 'biceps',
  calf: 'calves',
  pec: 'chest',
  pecs: 'chest',
  pectorals: 'chest',
  forearm: 'forearms',
  glute: 'glutes',
  hamstring: 'hamstrings',
  lat: 'lats',
  leg: 'legs',
  'lower body': 'legs',
  quad: 'quadriceps',
  quads: 'quadriceps',
  shoulder: 'shoulders',
  delt: 'shoulders',
  delts: 'shoulders',
  tricep: 'triceps',
};

export function anatomyRegionFor(name: string) {
  const normalized = name
    .trim()
    .toLocaleLowerCase()
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ');
  const key = Object.prototype.hasOwnProperty.call(groupAliases, normalized)
    ? groupAliases[normalized]
    : normalized;
  const region = Object.prototype.hasOwnProperty.call(groupRegions, key)
    ? groupRegions[key]
    : null;
  return region ? { key, ...region } : null;
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
  const [viewChoice, setViewChoice] = useState<BodyView>('front');
  const region = anatomyRegionFor(groupName);
  const view: BodyView = region?.[viewChoice]
    ? viewChoice
    : region?.front
      ? 'front'
      : 'back';
  const highlightedSlugs = region?.[view] ?? [];
  const paths = useMemo(
    () => bodyPaths.data.male[view] as AnatomyPath[],
    [view],
  );
  if (!region) return null;

  return (
    <View style={styles.card}>
      {region.front && region.back ? (
        <View style={styles.viewPicker}>
          {(['front', 'back'] as const).map((option) => (
            <Pressable
              key={option}
              onPress={() => setViewChoice(option)}
              style={[
                styles.viewOption,
                view === option && styles.viewOptionActive,
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: view === option }}
              accessibilityLabel={'Show ' + option + ' anatomy'}
            >
              <Text
                style={[
                  styles.viewOptionText,
                  view === option && styles.viewOptionTextActive,
                ]}
              >
                {option === 'front' ? 'Front' : 'Back'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Svg
        viewBox={viewBoxes[view]}
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
                  highlightedSlugs.includes(part.slug) &&
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
      {interactiveSlugs.length ? (
        <Text style={styles.caption}>
          Tap a highlighted region to filter exercises.
        </Text>
      ) : null}
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
  viewPicker: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  viewOption: {
    minHeight: 44,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    borderColor: colors.border,
    borderWidth: 1,
  },
  viewOptionActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  viewOptionText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  viewOptionTextActive: {
    color: colors.background,
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
