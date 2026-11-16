import { useFocusEffect, useRouter } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Dumbbell,
  Layers3,
  ListChecks,
  Trophy,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import {
  loadProgress,
  progressRange,
  type ProgressLoad,
  type ProgressPeriod,
} from '../../services/progressRepository';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import { useAuth } from '../auth/AuthProvider';
import { dateKey, formatSessionDate } from '../home/dates';

export function ProgressScreen() {
  const router = useRouter();
  const { accountId, status } = useAuth();
  const [period, setPeriod] = useState<ProgressPeriod>('week');
  const [offset, setOffset] = useState(0);
  const [result, setResult] = useState<ProgressLoad | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const todayKey = dateKey(new Date());
  const range = useMemo(
    () => progressRange(period, offset, new Date(`${todayKey}T12:00:00`)),
    [period, offset, todayKey],
  );
  useFocusEffect(
    useCallback(() => {
      if (!accountId) return;
      let active = true;
      setLoading(true);
      setResult(null);
      setError(null);
      void loadProgress(accountId, range, status === 'offline')
        .then((next) => {
          if (active) setResult(next);
        })
        .catch((error: unknown) => {
          if (active)
            setError(
              error instanceof Error
                ? error.message
                : 'Could not load progress.',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
      // The date key identifies the selected week.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId, status, range.cacheKey]),
  );
  const data = result?.summary;
  const visibleBests = data?.bests.slice(0, period === 'week' ? 3 : 5) ?? [];
  return (
    <ScreenFrame
      eyebrow="YOUR PROGRESS"
      title="Progress"
      subtitle="See the work you have logged."
    >
      <View style={styles.filters}>
        {(['week', 'month', 'all'] as const).map((item) => (
          <Pressable
            key={item}
            style={[styles.filter, period === item && styles.filterActive]}
            onPress={() => {
              setPeriod(item);
              setOffset(0);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: period === item }}
          >
            <Text
              style={[
                styles.filterText,
                period === item && styles.filterTextActive,
              ]}
            >
              {item === 'all' ? 'All Time' : item === 'week' ? 'Week' : 'Month'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.weekRow}>
        <Pressable
          style={styles.arrow}
          onPress={() => setOffset((value) => value - 1)}
          disabled={period === 'all'}
          accessibilityRole="button"
          accessibilityLabel={'Previous ' + period}
        >
          <ChevronLeft color={colors.textPrimary} />
        </Pressable>
        <Text style={styles.weekTitle}>{range.label}</Text>
        <Pressable
          style={styles.arrow}
          onPress={() => setOffset((value) => value + 1)}
          disabled={period === 'all'}
          accessibilityRole="button"
          accessibilityLabel={'Next ' + period}
        >
          <ChevronRight color={colors.textPrimary} />
        </Pressable>
      </View>
      {result?.error ? <Text style={styles.notice}>{result.error}</Text> : null}
      {error ? <Text style={styles.notice}>{error}</Text> : null}
      {result?.isCached ? (
        <Text style={styles.notice}>Showing saved data.</Text>
      ) : null}
      {loading && !data ? <ActivityIndicator color={colors.accent} /> : null}
      <View style={styles.grid}>
        <View style={styles.metric}>
          <Dumbbell color={colors.accent} size={25} />
          <Text style={styles.value}>{data?.completedCount ?? 0}</Text>
          <Text style={styles.label}>Completed sessions</Text>
        </View>
        <View style={styles.metric}>
          <Clock3 color={colors.accent} size={25} />
          <Text style={styles.value}>{data?.activeMinutes ?? 0} min</Text>
          <Text style={styles.label}>Active time</Text>
        </View>
        <View style={styles.metric}>
          <ListChecks color={colors.accent} size={25} />
          <Text style={styles.value}>{data?.totalExercises ?? 0}</Text>
          <Text style={styles.label}>Total exercises</Text>
        </View>
        <View style={styles.metric}>
          <Layers3 color={colors.accent} size={25} />
          <Text style={styles.value}>{data?.loggedSets ?? 0}</Text>
          <Text style={styles.label}>Logged sets</Text>
        </View>
      </View>
      <View style={styles.sectionHeading}>
        <Trophy color={colors.accent} size={24} />
        <Text style={styles.sectionTitle}>Personal Records</Text>
      </View>
      {visibleBests.length ? (
        visibleBests.map((best) => (
          <Pressable
            key={best.exerciseId}
            style={styles.sessionRow}
            onPress={() =>
              router.push({
                pathname: '/(tabs)/progress/exercise/[id]',
                params: { id: best.exerciseId },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={'Open ' + best.name}
          >
            <View style={styles.sessionText}>
              <Text style={styles.sessionName}>{best.name}</Text>
              <Text style={styles.sessionDate}>
                {formatSessionDate(best.performedAt)}
              </Text>
            </View>
            <Text style={styles.bestValue}>
              {best.weightKg} kg × {best.reps} reps
            </Text>
            <ChevronRight color={colors.accent} size={20} />
          </Pressable>
        ))
      ) : (
        <Text style={styles.empty}>
          {period === 'all'
            ? 'No personal records logged yet.'
            : 'No new weight records in this period.'}
        </Text>
      )}
      <Text style={styles.sectionTitle}>Sessions</Text>
      {data?.recent.length ? (
        data.recent.map((item) => (
          <Pressable
            key={item.session.id}
            style={styles.sessionRow}
            onPress={() =>
              router.push({
                pathname: '/session/[id]',
                params: {
                  id: item.session.planned_workout_id,
                  date: item.plannedDate,
                },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={'Open ' + item.name + ' session'}
          >
            <View style={styles.sessionText}>
              <Text style={styles.sessionName}>{item.name}</Text>
              <Text style={styles.sessionDate}>
                {formatSessionDate(
                  item.session.finished_at ?? item.session.started_at,
                )}{' '}
                · {item.session.status}
              </Text>
            </View>
            <Text style={styles.sessionMeta}>{item.setCount} sets</Text>
            <ChevronRight color={colors.textPrimary} size={20} />
          </Pressable>
        ))
      ) : (
        <Text style={styles.empty}>No finished sessions in this period.</Text>
      )}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  filters: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.lg },
  filter: {
    minHeight: sizing.touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterActive: { backgroundColor: colors.accent },
  filterText: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
  },
  filterTextActive: { color: colors.textOnAccent },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  bestValue: { color: colors.accent, fontFamily: typography.family.semibold },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.xl,
  },
  arrow: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 20,
  },
  notice: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    marginBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginBottom: spacing.xl,
  },
  metric: {
    width: '47%',
    minHeight: 136,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    gap: spacing.xs,
  },
  value: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 25,
  },
  label: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 22,
    marginBottom: spacing.md,
  },
  sessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  sessionText: { flex: 1 },
  sessionName: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  sessionDate: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
  },
  sessionMeta: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
  },
  empty: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
});
