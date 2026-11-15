import { useFocusEffect, useRouter } from 'expo-router';
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  Dumbbell,
  Layers3,
  ListChecks,
  Target,
  X,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountButton } from '../../components/AccountButton';
import { ApexBrand } from '../../components/ApexBrand';
import { useAuth } from '../auth/AuthProvider';
import { loadHome, type HomeLoadResult } from '../../services/homeRepository';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import {
  addDays,
  dateKey,
  formatDay,
  formatSessionDate,
  formatWeekRange,
  greetingFor,
  startOfWeek,
} from './dates';

function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return hours > 0 ? `${hours}h ${remaining}m` : `${minutes}m`;
}

function Metric({
  icon: Icon,
  value,
  label,
}: {
  icon: typeof Dumbbell;
  value: string;
  label: string;
}) {
  return (
    <View style={styles.metric}>
      <Icon size={22} color={colors.accent} />
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

export function HomeScreen() {
  const router = useRouter();
  const { accountId, status } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const [result, setResult] = useState<HomeLoadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  const today = new Date();
  const todayKey = dateKey(today);
  const weekStart = startOfWeek(
    addDays(new Date(`${todayKey}T12:00:00`), weekOffset * 7),
  );
  const weekKey = dateKey(weekStart);
  const weekDays = useMemo(
    () => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)),
    // The week key changes whenever the week changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [weekKey],
  );

  useFocusEffect(
    useCallback(() => {
      if (!accountId) return;
      let active = true;
      setLoading(true);
      setResult(null);
      void loadHome(accountId, weekStart, status === 'offline')
        .then((next) => {
          if (active) setResult(next);
        })
        .catch((error: unknown) => {
          if (active) {
            setResult({
              snapshot: null,
              isCached: false,
              error:
                error instanceof Error ? error.message : 'Could not load Home.',
            });
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
      // weekKey identifies the selected calendar week.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId, status, weekKey]),
  );

  async function refresh() {
    if (!accountId) return;
    setRefreshing(true);
    try {
      setResult(await loadHome(accountId, weekStart, status === 'offline'));
    } finally {
      setRefreshing(false);
    }
  }

  const data = result?.snapshot;
  const todayPlans = data?.plans.filter(
    (plan) => plan.planned_date === todayKey && plan.status !== 'skipped',
  );
  const visiblePlans =
    weekOffset === 0
      ? todayPlans
      : data?.plans.filter((plan) => plan.status !== 'skipped');
  const selectedPlans = data?.plans.filter(
    (plan) => plan.planned_date === (selectedDay ? dateKey(selectedDay) : ''),
  );
  const goal = data?.weeklyGoal ?? null;
  const completed = data?.completedCount ?? 0;
  const progress = goal === null ? 0 : Math.min(100, (completed / goal) * 100);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
            tintColor={colors.accent}
          />
        }
      >
        <View style={styles.heroArea}>
          <View pointerEvents="none" style={styles.heroSlashOne} />
          <View pointerEvents="none" style={styles.heroSlashTwo} />
          <AccountButton />
          <ApexBrand />
          <Text style={styles.brandSub}>TRAIN / LOG / PROGRESS</Text>
          <Text style={styles.greeting}>
            Good{' '}
            <Text style={styles.greetingAccent}>
              {greetingFor(today)},{'\n'}Spencer.
            </Text>
          </Text>
          <Text style={styles.subGreeting}>Here’s your week at a glance.</Text>
        </View>

        {status === 'offline' || result?.isCached ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>
              Showing saved data. Pull to refresh when online.
            </Text>
          </View>
        ) : null}
        {result?.error ? (
          <View style={styles.notice}>
            <Text style={styles.noticeText}>{result.error}</Text>
          </View>
        ) : null}

        <View style={styles.weekHeading}>
          <Pressable
            onPress={() => setWeekOffset((current) => current - 1)}
            style={styles.weekArrow}
            accessibilityRole="button"
            accessibilityLabel="Previous week"
          >
            <ChevronLeft size={25} color={colors.textPrimary} />
          </Pressable>
          <View style={styles.weekTitleBlock}>
            <Text style={styles.weekTitle}>{formatWeekRange(weekStart)}</Text>
            <Text style={styles.weekSubtitle}>{weekStart.getFullYear()}</Text>
          </View>
          <Pressable
            onPress={() => setWeekOffset((current) => current + 1)}
            style={styles.weekArrow}
            accessibilityRole="button"
            accessibilityLabel="Next week"
          >
            <ChevronRight size={25} color={colors.textPrimary} />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.weekStrip}
        >
          {weekDays.map((day) => {
            const key = dateKey(day);
            const dayPlans =
              data?.plans.filter((plan) => plan.planned_date === key) ?? [];
            const isToday = key === todayKey;
            const hasCompleted = dayPlans.some(
              (plan) => data?.sessionStatusByPlan?.[plan.id] === 'completed',
            );
            const hasPlanned = dayPlans.some((plan) =>
              ['planned', 'in_progress', 'partial'].includes(
                data?.sessionStatusByPlan?.[plan.id] ?? plan.status,
              ),
            );
            return (
              <Pressable
                key={key}
                style={[styles.dayCard, isToday && styles.dayCardToday]}
                onPress={() => setSelectedDay(day)}
                accessibilityRole="button"
                accessibilityLabel={`${formatDay(day)}, ${dayPlans.length} workouts`}
              >
                <Text style={[styles.dayName, isToday && styles.dayTextToday]}>
                  {new Intl.DateTimeFormat('en-AU', {
                    weekday: 'short',
                  }).format(day)}
                </Text>
                <Text
                  style={[styles.dayNumber, isToday && styles.dayTextToday]}
                >
                  {day.getDate()}
                </Text>
                {hasCompleted ? (
                  <View style={styles.completedDot}>
                    <Check
                      size={15}
                      color={colors.textOnAccent}
                      strokeWidth={3}
                    />
                  </View>
                ) : hasPlanned ? (
                  <Dumbbell
                    size={20}
                    color={isToday ? colors.textOnAccent : colors.accent}
                  />
                ) : (
                  <Circle
                    size={17}
                    color={isToday ? colors.textOnAccent : colors.textMuted}
                  />
                )}
              </Pressable>
            );
          })}
        </ScrollView>

        <View style={styles.todayCard}>
          <View pointerEvents="none" style={styles.cardSlash} />
          <View style={styles.todayContent}>
            <Text style={styles.eyebrow}>
              {weekOffset === 0 ? 'TODAY’S WORKOUT' : 'THIS WEEK’S WORKOUTS'}
            </Text>
            <Text style={styles.todayTitle}>
              {visiblePlans?.length
                ? visiblePlans.length === 1
                  ? visiblePlans[0].name_snapshot
                  : `${visiblePlans.length} workouts planned`
                : 'No workout planned'}
            </Text>
            <Text style={styles.todayDetail}>
              {visiblePlans?.length === 1
                ? `${data?.exerciseCountByPlan[visiblePlans[0].id] ?? 0} exercises`
                : visiblePlans?.length
                  ? visiblePlans.map((plan) => plan.name_snapshot).join(' • ')
                  : 'No workouts scheduled for this period.'}
            </Text>
            <Pressable
              style={styles.primaryButton}
              onPress={() => {
                if (
                  visiblePlans?.length === 1 &&
                  ['planned', 'in_progress'].includes(visiblePlans[0].status)
                )
                  router.push({
                    pathname: '/session/[id]',
                    params: {
                      id: visiblePlans[0].id,
                      date: visiblePlans[0].planned_date,
                    },
                  });
                else if (
                  weekOffset === 0 &&
                  visiblePlans &&
                  visiblePlans.length > 1
                )
                  setSelectedDay(today);
                else router.push('/(tabs)/plan');
              }}
              accessibilityRole="button"
              accessibilityLabel={
                visiblePlans?.length === 1
                  ? 'Open workout session'
                  : 'Open workout plan'
              }
            >
              <CalendarDays size={23} color={colors.textOnAccent} />
              <Text style={styles.primaryButtonText}>
                {visiblePlans?.length === 1 &&
                ['planned', 'in_progress'].includes(visiblePlans[0].status)
                  ? visiblePlans[0].status === 'in_progress'
                    ? 'Resume Session'
                    : 'Start Session'
                  : visiblePlans?.length
                    ? 'View Workouts'
                    : 'Open Plan'}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.goalCard}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionHeadingLeft}>
              <Target size={27} color={colors.accent} />
              <Text style={styles.sectionTitle}>Weekly Goal</Text>
            </View>
            <Text style={styles.goalCount}>
              {goal === null ? (
                'Set a goal in Plan'
              ) : (
                <>
                  <Text style={styles.accentText}>{completed}</Text> / {goal}
                </>
              )}
            </Text>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${progress}%` }]} />
          </View>
          <View style={styles.metricsRow}>
            <Metric
              icon={Dumbbell}
              value={String(completed)}
              label="Completed sessions"
            />
            <Metric
              icon={Clock3}
              value={formatDuration(data?.activeMinutes ?? 0)}
              label="Active time"
            />
            <Metric
              icon={ListChecks}
              value={String(data?.totalExercises ?? 0)}
              label="Total exercises"
            />
            <Metric
              icon={Layers3}
              value={String(data?.loggedSets ?? 0)}
              label="Logged sets"
            />
          </View>
        </View>

        <View style={styles.recentCard}>
          <View style={styles.sectionHeading}>
            <View style={styles.sectionHeadingLeft}>
              <Clock3 size={27} color={colors.accent} />
              <Text style={styles.sectionTitle}>Recent Sessions</Text>
            </View>
          </View>
          {loading && !data ? (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          ) : data?.recent.length ? (
            data.recent.map((item) => (
              <Pressable
                key={item.session.id}
                style={styles.recentRow}
                onPress={() =>
                  router.push({
                    pathname: '/session/[id]',
                    params: {
                      id: item.session.planned_workout_id,
                      date:
                        item.plannedDate ??
                        item.session.started_at.slice(0, 10),
                    },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel={`Open ${item.name} session`}
              >
                <View
                  style={[
                    styles.recentStatus,
                    item.session.status === 'partial' &&
                      styles.recentStatusPartial,
                  ]}
                >
                  {item.session.status === 'completed' ? (
                    <Check size={18} color={colors.textOnAccent} />
                  ) : (
                    <Circle size={18} color={colors.textOnAccent} />
                  )}
                </View>
                <View style={styles.recentMain}>
                  <Text style={styles.recentName}>{item.name}</Text>
                  <Text style={styles.recentDate}>
                    {formatSessionDate(
                      item.session.finished_at ?? item.session.started_at,
                    )}
                  </Text>
                </View>
                <Text style={styles.recentMeta}>
                  {item.setCount} sets · {formatDuration(item.durationMinutes)}
                </Text>
              </Pressable>
            ))
          ) : (
            <Text style={styles.emptyText}>
              Your finished workouts will appear here.
            </Text>
          )}
        </View>
      </ScrollView>

      <Modal
        visible={selectedDay !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedDay(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeading}>
              <Text style={styles.modalTitle}>
                {selectedDay ? formatDay(selectedDay) : ''}
              </Text>
              <Pressable
                onPress={() => setSelectedDay(null)}
                style={styles.modalClose}
                accessibilityRole="button"
                accessibilityLabel="Close day workouts"
              >
                <X size={22} color={colors.textPrimary} />
              </Pressable>
            </View>
            <ScrollView style={styles.modalList}>
              {selectedPlans?.length ? (
                selectedPlans.map((plan) => (
                  <Pressable
                    key={plan.id}
                    style={styles.modalWorkout}
                    onPress={() => {
                      setSelectedDay(null);
                      if (plan.status !== 'skipped')
                        router.push({
                          pathname: '/session/[id]',
                          params: { id: plan.id, date: plan.planned_date },
                        });
                      else router.push('/(tabs)/plan');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${plan.name_snapshot}`}
                  >
                    <Dumbbell size={20} color={colors.accent} />
                    <View style={styles.modalWorkoutText}>
                      <Text style={styles.modalWorkoutName}>
                        {plan.name_snapshot}
                      </Text>
                      <Text style={styles.modalWorkoutStatus}>
                        {(
                          data?.sessionStatusByPlan?.[plan.id] ?? plan.status
                        ).replace('_', ' ')}
                      </Text>
                    </View>
                  </Pressable>
                ))
              ) : (
                <Text style={styles.emptyText}>
                  No workouts scheduled for this day.
                </Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: 120 },
  heroArea: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    overflow: 'hidden',
  },
  heroSlashOne: {
    position: 'absolute',
    top: -60,
    right: 35,
    width: 82,
    height: 230,
    backgroundColor: colors.accent,
    opacity: 0.18,
    transform: [{ rotate: '28deg' }],
  },
  heroSlashTwo: {
    position: 'absolute',
    top: -55,
    right: 8,
    width: 17,
    height: 210,
    backgroundColor: colors.accent,
    opacity: 0.35,
    transform: [{ rotate: '28deg' }],
  },
  brandSub: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: 10,
    letterSpacing: 1.5,
    textAlign: 'center',
  },
  greeting: {
    marginTop: spacing.lg,
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.greeting,
    lineHeight: 40,
  },
  greetingAccent: { color: colors.accent },
  subGreeting: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    marginTop: spacing.sm,
  },
  notice: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.surface,
  },
  noticeText: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
  },
  weekHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  weekArrow: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  weekTitleBlock: { alignItems: 'center', gap: spacing.xs },
  weekTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 20,
  },
  weekSubtitle: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
  },
  weekStrip: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginBottom: spacing.lg,
  },
  dayCard: {
    width: 48,
    minHeight: 96,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: spacing.xs,
  },
  dayCardToday: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayName: {
    color: colors.textPrimary,
    fontFamily: typography.family.regular,
    fontSize: 11,
  },
  dayNumber: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 17,
  },
  dayTextToday: { color: colors.textOnAccent },
  completedDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.success,
    alignItems: 'center',
    justifyContent: 'center',
  },
  todayCard: {
    minHeight: 218,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderLeftWidth: 7,
    borderLeftColor: colors.accent,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    marginBottom: spacing.lg,
  },
  cardSlash: {
    position: 'absolute',
    top: -55,
    right: 10,
    width: 105,
    height: 300,
    backgroundColor: colors.accent,
    opacity: 0.09,
    transform: [{ rotate: '26deg' }],
  },
  todayContent: { padding: spacing.xl },
  eyebrow: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
    letterSpacing: 2,
  },
  todayTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.hero,
    marginTop: spacing.xs,
  },
  todayDetail: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    marginBottom: spacing.lg,
  },
  primaryButton: {
    minHeight: 56,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  primaryButtonText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: 20,
  },
  goalCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  sectionHeadingLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 21,
  },
  goalCount: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  accentText: { color: colors.accent },
  progressTrack: {
    height: 11,
    backgroundColor: colors.border,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
  },
  metricsRow: { flexDirection: 'row', marginTop: spacing.lg },
  metric: { flex: 1, alignItems: 'center', gap: spacing.xs },
  metricValue: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 16,
    textAlign: 'center',
  },
  metricLabel: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: 10,
    textAlign: 'center',
  },
  recentCard: {
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  recentStatus: {
    width: 30,
    height: 30,
    backgroundColor: colors.success,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentStatusPartial: { backgroundColor: colors.warning },
  recentMain: { flex: 1 },
  recentName: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  recentDate: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
  },
  recentMeta: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: 11,
  },
  emptyText: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
  },
  loader: { marginVertical: spacing.xl },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalPanel: {
    maxHeight: '75%',
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  modalList: { flexGrow: 0 },
  modalHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.lg,
  },
  modalTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.title,
  },
  modalClose: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalWorkout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  modalWorkoutText: { flex: 1 },
  modalWorkoutName: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  modalWorkoutStatus: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    textTransform: 'capitalize',
  },
});
