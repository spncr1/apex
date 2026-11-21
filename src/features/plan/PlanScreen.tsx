import { useFocusEffect, useRouter } from 'expo-router';
import * as Crypto from 'expo-crypto';
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  MoreHorizontal,
  Plus,
} from 'lucide-react-native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import {
  adaptPlannedWorkout,
  archiveFinishedWorkout,
  createPlannedWorkout,
  loadPlanning,
  loadSwapCandidates,
  savePlannedWorkout,
  saveWeeklyGoal,
  type PlanDetail,
  type PlanningLoadResult,
} from '../../services/planningRepository';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import { useDesktopLayout } from '../../theme/useDesktopLayout';
import type { PlannedWorkoutRow } from '../../types/database';
import { useAuth } from '../auth/AuthProvider';
import {
  addDays,
  dateKey,
  formatDay,
  formatWeekRange,
  startOfWeek,
} from '../home/dates';
import { WorkoutEditor, type WorkoutEditorValue } from './WorkoutEditor';
import { PlanActionSheet, type PlanAction } from './PlanActionSheet';

type EditorSelection =
  | { kind: 'new_for_date'; date: string; id: string }
  | { kind: 'plan'; detail: PlanDetail };

function initialEditorValue(selection: EditorSelection): WorkoutEditorValue {
  if (selection.kind === 'new_for_date') {
    return { name: '', goal: '', exercises: [] };
  }
  return {
    name: selection.detail.plan.name_snapshot,
    goal: selection.detail.plan.goal_snapshot ?? '',
    exercises: selection.detail.exercises,
  };
}

export function PlanScreen() {
  const router = useRouter();
  const desktop = useDesktopLayout();
  const [selectedDayIndex, setSelectedDayIndex] = useState(
    () => (new Date().getDay() + 6) % 7,
  );
  const { accountId, status } = useAuth();
  const [weekOffset, setWeekOffset] = useState(0);
  const [reloadVersion, setReloadVersion] = useState(0);
  const [result, setResult] = useState<PlanningLoadResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [editor, setEditor] = useState<EditorSelection | null>(null);
  const [editorHidden, setEditorHidden] = useState(false);
  const [actionPlan, setActionPlan] = useState<PlanDetail | null>(null);
  const [swapCandidates, setSwapCandidates] = useState<PlannedWorkoutRow[]>([]);
  const [goalDraft, setGoalDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const todayKey = dateKey(new Date());
  const monday = useMemo(
    () =>
      startOfWeek(addDays(new Date(`${todayKey}T12:00:00`), weekOffset * 7)),
    [weekOffset, todayKey],
  );
  const weekKey = dateKey(monday);

  useFocusEffect(
    useCallback(() => {
      setEditorHidden(false);
      if (!accountId) return;
      let active = true;
      setLoading(true);
      void loadPlanning(accountId, monday, status === 'offline')
        .then((next) => {
          if (!active) return;
          setResult(next);
          if (next.snapshot)
            setGoalDraft(
              next.snapshot.weeklyGoal === null
                ? ''
                : String(next.snapshot.weeklyGoal),
            );
        })
        .catch((issue: unknown) => {
          if (active)
            setResult({
              snapshot: null,
              isCached: false,
              error:
                issue instanceof Error ? issue.message : 'Could not load plan.',
            });
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
      // The date key and reload version identify the requested view.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [accountId, status, weekKey, reloadVersion]),
  );

  const snapshot = result?.snapshot;
  const offline = status === 'offline';

  async function saveEditor(value: WorkoutEditorValue) {
    if (!editor) return;
    if (editor.kind === 'plan') {
      await savePlannedWorkout({
        id: editor.detail.plan.id,
        revision: editor.detail.plan.revision,
        name: value.name,
        goal: value.goal,
        exercises: value.exercises,
      });
    } else {
      await createPlannedWorkout({
        id: editor.id,
        date: editor.date,
        name: value.name,
        goal: value.goal,
        exercises: value.exercises,
      });
    }
    setEditor(null);
    setReloadVersion((value) => value + 1);
  }

  async function updateGoal() {
    if (!accountId || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      await saveWeeklyGoal(accountId, Number(goalDraft));
      setReloadVersion((value) => value + 1);
    } catch (issue) {
      setActionError(
        issue instanceof Error ? issue.message : 'Could not update goal.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function runAction(selection: PlanAction) {
    if (!actionPlan || busy) return;
    if (selection.action === 'skip') {
      const confirmed =
        Platform.OS === 'web'
          ? window.confirm(`Skip ${actionPlan.plan.name_snapshot}?`)
          : await new Promise<boolean>((resolve) =>
              Alert.alert('Skip workout?', actionPlan.plan.name_snapshot, [
                {
                  text: 'Cancel',
                  style: 'cancel',
                  onPress: () => resolve(false),
                },
                {
                  text: 'Skip',
                  style: 'destructive',
                  onPress: () => resolve(true),
                },
              ]),
            );
      if (!confirmed) return;
    }
    setBusy(true);
    setActionError(null);
    try {
      await adaptPlannedWorkout({
        action: selection.action,
        planId: actionPlan.plan.id,
        revision: actionPlan.plan.revision,
        otherPlanId:
          selection.action === 'swap' ? selection.other.id : undefined,
        otherRevision:
          selection.action === 'swap' ? selection.other.revision : undefined,
        targetDate: selection.action === 'move' ? selection.date : undefined,
      });
      setActionPlan(null);
      setReloadVersion((value) => value + 1);
    } catch (issue) {
      setActionError(
        issue instanceof Error ? issue.message : 'Could not change workout.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function openActions(detail: PlanDetail) {
    if (!accountId) return;
    setActionPlan(detail);
    setActionError(null);
    setSwapCandidates([]);
    try {
      setSwapCandidates(
        await loadSwapCandidates(
          accountId,
          detail.plan.id,
          detail.plan.planned_date,
        ),
      );
    } catch (issue) {
      setActionError(
        issue instanceof Error ? issue.message : 'Could not load swap options.',
      );
    }
  }

  async function removeFinished(detail: PlanDetail) {
    if (!accountId || busy || offline) return;
    const name = detail.plan.name_snapshot;
    const message =
      'This workout will disappear from Plan, history, and progress totals. You can add a fresh workout for this day.';
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(`Remove ${name}?\n\n${message}`)
        : await new Promise<boolean>((resolve) =>
            Alert.alert(`Remove ${name}?`, message, [
              {
                text: 'Cancel',
                style: 'cancel',
                onPress: () => resolve(false),
              },
              {
                text: 'Remove',
                style: 'destructive',
                onPress: () => resolve(true),
              },
            ]),
          );
    if (!confirmed) return;
    setBusy(true);
    setActionError(null);
    try {
      await archiveFinishedWorkout(accountId, detail.plan);
      setReloadVersion((value) => value + 1);
    } catch (issue) {
      setActionError(
        issue instanceof Error ? issue.message : 'Could not remove workout.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenFrame
      eyebrow="YOUR SCHEDULE"
      title="Plan"
      subtitle="Build workouts and schedule your week."
    >
      {result?.error ? <Text style={styles.error}>{result.error}</Text> : null}
      {result?.isCached ? (
        <Text style={styles.notice}>Showing saved data.</Text>
      ) : null}
      {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
      {loading && !snapshot ? (
        <ActivityIndicator color={colors.accent} />
      ) : null}
      {!loading && !snapshot && !result?.error ? (
        <Text style={styles.notice}>No saved plan is available offline.</Text>
      ) : null}

      {snapshot ? (
        <>
          <View style={styles.goalCard}>
            <View style={styles.sectionHeading}>
              <CalendarDays size={23} color={colors.accent} />
              <Text style={styles.sectionTitle}>Weekly Goal</Text>
            </View>
            <View style={styles.goalControls}>
              <TextInput
                value={goalDraft}
                onChangeText={(value) =>
                  setGoalDraft(value.replace(/[^1-9]/g, '').slice(0, 1))
                }
                keyboardType="number-pad"
                maxLength={1}
                style={styles.goalInput}
                editable={!offline}
                accessibilityLabel="Weekly workout goal"
              />
              <Text style={styles.goalUnit}>completed workouts</Text>
              <Pressable
                style={[
                  styles.smallButton,
                  (offline || busy || !goalDraft) && styles.disabled,
                ]}
                disabled={offline || busy || !goalDraft}
                onPress={() => void updateGoal()}
                accessibilityRole="button"
                accessibilityLabel="Save weekly goal"
              >
                <Text style={styles.smallButtonText}>Save</Text>
              </Pressable>
            </View>
          </View>

          <View style={styles.weekRow}>
            <Pressable
              style={styles.arrow}
              onPress={() => setWeekOffset((value) => value - 1)}
              accessibilityRole="button"
              accessibilityLabel="Previous week"
            >
              <ChevronLeft color={colors.textPrimary} />
            </Pressable>
            <Text style={styles.weekTitle}>{formatWeekRange(monday)}</Text>
            <Pressable
              style={styles.arrow}
              onPress={() => setWeekOffset((value) => value + 1)}
              accessibilityRole="button"
              accessibilityLabel="Next week"
            >
              <ChevronRight color={colors.textPrimary} />
            </Pressable>
          </View>
          <View style={desktop && styles.desktopSchedule}>
            {desktop && (
              <View style={styles.desktopDayList}>
                {Array.from({ length: 7 }, (_, index) => {
                  const day = addDays(monday, index);
                  const dayPlans = snapshot.plans.filter(
                    (detail) => detail.plan.planned_date === dateKey(day),
                  );
                  return (
                    <Pressable
                      key={dateKey(day)}
                      onPress={() => setSelectedDayIndex(index)}
                      style={({ hovered }) => [
                        styles.desktopDayButton,
                        selectedDayIndex === index && styles.desktopDaySelected,
                        hovered &&
                          selectedDayIndex !== index &&
                          styles.desktopDayHovered,
                      ]}
                      accessibilityRole="button"
                      accessibilityState={{
                        selected: selectedDayIndex === index,
                      }}
                      accessibilityLabel={`Show ${formatDay(day)} workouts`}
                    >
                      <Text style={styles.desktopDayTitle}>
                        {formatDay(day)}
                      </Text>
                      <Text style={styles.desktopDaySummary} numberOfLines={1}>
                        {dayPlans.length
                          ? dayPlans
                              .map((detail) => detail.plan.name_snapshot)
                              .join(' · ')
                          : 'No workout scheduled'}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <View style={desktop && styles.desktopDayDetails}>
              {(desktop
                ? [selectedDayIndex]
                : Array.from({ length: 7 }, (_, index) => index)
              ).map((index) => {
                const day = addDays(monday, index);
                const dayKey = dateKey(day);
                const dayPlans = snapshot.plans.filter(
                  (detail) => detail.plan.planned_date === dayKey,
                );
                return (
                  <View key={dayKey} style={styles.daySection}>
                    <View style={styles.dayHeader}>
                      <Text style={styles.dayTitle}>{formatDay(day)}</Text>
                      <Pressable
                        style={[
                          styles.addDayButton,
                          offline && styles.disabled,
                        ]}
                        disabled={offline}
                        onPress={() => {
                          setActionError(null);
                          setEditor({
                            kind: 'new_for_date',
                            date: dayKey,
                            id: Crypto.randomUUID(),
                          });
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`Add workout on ${formatDay(day)}`}
                      >
                        <Plus size={16} color={colors.accent} />
                        <Text style={styles.addDayText}>Add workout</Text>
                      </Pressable>
                    </View>
                    {dayPlans.length ? (
                      dayPlans.map((detail) => (
                        <View key={detail.plan.id}>
                          <View style={styles.workoutRow}>
                            <Dumbbell size={22} color={colors.accent} />
                            <View style={styles.workoutText}>
                              <Text style={styles.workoutName}>
                                {detail.plan.name_snapshot}
                              </Text>
                              <Text style={styles.meta}>
                                {detail.exercises.length} exercises ·{' '}
                                {detail.plan.status.replace('_', ' ')}
                                {detail.plan.is_overridden ? ' · edited' : ''}
                              </Text>
                            </View>
                            {detail.plan.status === 'planned' ||
                            detail.plan.status === 'in_progress' ? (
                              <Pressable
                                style={styles.editButton}
                                onPress={() =>
                                  router.push({
                                    pathname: '/session/[id]',
                                    params: {
                                      id: detail.plan.id,
                                      date: detail.plan.planned_date,
                                    },
                                  })
                                }
                                accessibilityRole="button"
                                accessibilityLabel={`${detail.plan.status === 'planned' ? 'Open' : 'Continue'} ${detail.plan.name_snapshot} session`}
                              >
                                <Text style={styles.editText}>
                                  {detail.plan.status === 'planned'
                                    ? 'Start'
                                    : 'Continue'}
                                </Text>
                              </Pressable>
                            ) : null}
                            {detail.plan.status === 'planned' && !offline ? (
                              <Pressable
                                style={styles.editButton}
                                onPress={() =>
                                  setEditor({ kind: 'plan', detail })
                                }
                                accessibilityRole="button"
                                accessibilityLabel={`Edit ${detail.plan.name_snapshot} on ${formatDay(day)}`}
                              >
                                <Text style={styles.editText}>Edit</Text>
                              </Pressable>
                            ) : null}
                            {detail.plan.status === 'completed' ||
                            detail.plan.status === 'partial' ? (
                              <Pressable
                                style={styles.editButton}
                                onPress={() =>
                                  router.push({
                                    pathname: '/session/[id]',
                                    params: {
                                      id: detail.plan.id,
                                      date: detail.plan.planned_date,
                                    },
                                  })
                                }
                                accessibilityRole="button"
                                accessibilityLabel={`View ${detail.plan.name_snapshot} finished workout`}
                              >
                                <Text style={styles.editText}>View</Text>
                              </Pressable>
                            ) : null}
                            {(detail.plan.status === 'completed' ||
                              detail.plan.status === 'partial') &&
                            !offline ? (
                              <Pressable
                                style={styles.editButton}
                                disabled={busy}
                                onPress={() => void removeFinished(detail)}
                                accessibilityRole="button"
                                accessibilityLabel={`Remove ${detail.plan.name_snapshot} finished workout`}
                              >
                                <Text style={styles.removeText}>Remove</Text>
                              </Pressable>
                            ) : null}
                            {detail.plan.status === 'planned' && !offline ? (
                              <Pressable
                                style={styles.editButton}
                                onPress={() => {
                                  void openActions(detail);
                                }}
                                accessibilityRole="button"
                                accessibilityLabel={`More actions for ${detail.plan.name_snapshot}`}
                              >
                                <MoreHorizontal
                                  size={22}
                                  color={colors.accent}
                                />
                              </Pressable>
                            ) : null}
                          </View>
                          {desktop && detail.exercises.length > 0 && (
                            <View style={styles.desktopExercisePreview}>
                              <Text style={styles.desktopPreviewTitle}>
                                Planned exercises
                              </Text>
                              {detail.exercises.map((exercise) => (
                                <Text
                                  key={exercise.exercise_id}
                                  style={styles.desktopPreviewExercise}
                                >
                                  {exercise.name} · {exercise.sets.length}{' '}
                                  {exercise.sets.length === 1 ? 'set' : 'sets'}
                                </Text>
                              ))}
                            </View>
                          )}
                        </View>
                      ))
                    ) : (
                      <Text style={styles.empty}>No workout scheduled</Text>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </>
      ) : null}

      {editor && snapshot ? (
        <WorkoutEditor
          key={
            editor.kind === 'new_for_date' ? editor.id : editor.detail.plan.id
          }
          title={
            editor.kind === 'new_for_date' ? 'Add Workout' : 'Edit Workout'
          }
          initial={initialEditorValue(editor)}
          catalog={snapshot.catalog}
          visible={!editorHidden}
          onClose={() => setEditor(null)}
          onOpenExercise={(id) => {
            setEditorHidden(true);
            router.push({
              pathname: '/(tabs)/plan/exercise/[id]',
              params: { id },
            });
          }}
          onSave={saveEditor}
        />
      ) : null}

      {actionPlan && snapshot ? (
        <PlanActionSheet
          key={actionPlan.plan.id}
          plan={actionPlan}
          otherPlans={swapCandidates}
          busy={busy}
          error={actionError}
          onAction={(selection) => void runAction(selection)}
          onClose={() => setActionPlan(null)}
        />
      ) : null}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  desktopSchedule: {
    flexDirection: 'row',
    gap: spacing.xl,
    alignItems: 'flex-start',
  },
  desktopDayList: { width: 260, gap: spacing.sm },
  desktopDayDetails: { flex: 1, minWidth: 0 },
  desktopDayButton: {
    minHeight: 64,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  desktopDaySelected: { borderColor: colors.accent, borderLeftWidth: 5 },
  desktopDayHovered: { backgroundColor: colors.surfaceElevated },
  desktopDayTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  desktopExercisePreview: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  desktopPreviewTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
    marginBottom: spacing.sm,
  },
  desktopPreviewExercise: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    paddingVertical: spacing.xs,
  },
  desktopDaySummary: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  error: {
    color: colors.danger,
    fontFamily: typography.family.regular,
    marginBottom: spacing.md,
  },
  notice: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    marginBottom: spacing.md,
  },
  goalCard: {
    borderWidth: 1,
    borderLeftWidth: 5,
    borderLeftColor: colors.accent,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 19,
  },
  goalControls: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  goalInput: {
    width: 56,
    flexShrink: 0,
    height: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    textAlign: 'center',
  },
  goalUnit: {
    flex: 1,
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
  },
  smallButton: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  smallButtonText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  disabled: { opacity: 0.5 },
  workoutName: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    flex: 1,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    marginTop: spacing.xs,
    textTransform: 'capitalize',
  },
  editButton: {
    minWidth: sizing.touchTarget,
    minHeight: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editText: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  removeText: {
    color: colors.danger,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  weekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.xl,
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
  daySection: { marginBottom: spacing.lg },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  dayTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 18,
  },
  addDayButton: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addDayText: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  workoutRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  workoutText: { flex: 1 },
  empty: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    marginBottom: spacing.sm,
  },
});
