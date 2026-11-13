import { useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Pause,
  Play,
  Plus,
} from 'lucide-react-native';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AccountButton } from '../../components/AccountButton';
import { ApexBrand } from '../../components/ApexBrand';
import {
  loadWorkoutSession,
  persistWorkoutSession,
  type SessionLoad,
} from '../../services/sessionRepository';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import type { SessionSnapshot } from '../../types/database';
import { useAuth } from '../auth/AuthProvider';
import { formatDay } from '../home/dates';
import {
  activeMilliseconds,
  addSet,
  saveEditedSnapshot,
  finishSnapshot,
  isRunning,
  pauseSnapshot,
  resumeSnapshot,
  setComments,
  startSnapshot,
  updateSet,
} from './sessionEngine';

type SetDraft = { reps: string; weight: string; notes: string };
const stamp = () => new Date().toISOString();
const formatTimer = (milliseconds: number) => {
  const seconds = Math.floor(milliseconds / 1000);
  return [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ]
    .map((part) => String(part).padStart(2, '0'))
    .join(':');
};

export function SessionScreen() {
  const { id, date } = useLocalSearchParams<{ id: string; date: string }>();
  const router = useRouter();
  const { accountId, status } = useAuth();
  const [loaded, setLoaded] = useState<SessionLoad | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [now, setNow] = useState(stamp);
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>({});
  const [comments, setCommentsDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [editBase, setEditBase] = useState<SessionSnapshot | null>(null);

  const reload = useCallback(async () => {
    if (!accountId || !id || !date) return;
    setLoading(true);
    try {
      const result = await loadWorkoutSession(
        accountId,
        id,
        date,
        status === 'offline',
      );
      setLoaded(result);
      setCommentsDraft(result.snapshot?.session.comments ?? '');
      setDrafts(
        Object.fromEntries(
          (result.snapshot?.sets ?? []).map((set) => [
            set.id,
            {
              reps: set.actual_reps === null ? '' : String(set.actual_reps),
              weight:
                set.actual_weight_kg === null
                  ? ''
                  : String(set.actual_weight_kg),
              notes: set.notes ?? '',
            },
          ]),
        ),
      );
      setMessage(result.error);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not load session.',
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, id, date, status]);

  useEffect(() => {
    void Promise.resolve().then(reload);
  }, [reload]);
  useEffect(() => {
    const timer = setInterval(() => setNow(stamp()), 1000);
    return () => clearInterval(timer);
  }, []);

  const snapshot = editing
    ? (editBase ?? loaded?.snapshot ?? null)
    : (loaded?.snapshot ?? null);
  const editable =
    (snapshot?.session.status === 'in_progress' || editing) &&
    loaded?.syncState !== 'conflict';
  const running = snapshot ? isRunning(snapshot) : false;
  const exerciseCount =
    snapshot?.exercises.length ?? loaded?.plan?.exercises.length ?? 0;
  const workingSetCount =
    snapshot?.sets.length ??
    loaded?.plan?.exercises.reduce(
      (total, exercise) => total + exercise.sets.length,
      0,
    ) ??
    0;

  async function persist(next: SessionSnapshot) {
    if (!accountId) return;
    await persistWorkoutSession(accountId, next, status === 'signed_in');
    setLoaded((current) =>
      current ? { ...current, snapshot: next, syncState: 'pending' } : current,
    );
  }

  async function act(operation: () => SessionSnapshot) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await persist(operation());
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not save session.',
      );
    } finally {
      setBusy(false);
    }
  }

  function foldDrafts(base: SessionSnapshot): SessionSnapshot {
    let next = setComments(base, comments, stamp());
    for (const set of base.sets) {
      const draft = drafts[set.id];
      if (!draft) continue;
      const reps = draft.reps.trim();
      const weight = draft.weight.trim();
      if ((reps === '') !== (weight === ''))
        throw new Error(
          `Enter both reps and weight for set ${set.set_number}.`,
        );
      if (reps && (!/^\d+$/.test(reps) || !/^\d+(\.\d{1,2})?$/.test(weight)))
        throw new Error('Use valid reps and weight values.');
      next = updateSet(
        next,
        set.id,
        {
          actual_reps: reps ? Number(reps) : null,
          actual_weight_kg: weight ? Number(weight) : null,
          notes: draft.notes.trim() || null,
        },
        stamp(),
      );
    }
    return next;
  }

  function saveDrafts() {
    if (!snapshot || snapshot.session.status !== 'in_progress' || !editable)
      return;
    void act(() => foldDrafts(snapshot));
  }

  async function saveEdits() {
    if (!snapshot || !editing || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await persist(saveEditedSnapshot(foldDrafts(snapshot), stamp()));
      setEditing(false);
      setEditBase(null);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Could not save session changes.',
      );
    } finally {
      setBusy(false);
    }
  }

  function finish() {
    if (!snapshot || !editable) return;
    let next: SessionSnapshot;
    try {
      next = finishSnapshot(foldDrafts(snapshot), stamp());
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not finish session.',
      );
      return;
    }
    const detail =
      next.session.status === 'partial'
        ? 'This will be partial because at least one exercise has no logged working set.'
        : 'Your logged workout will be marked complete.';
    if (Platform.OS === 'web') {
      if (window.confirm(`Finish session?\n\n${detail}`)) void act(() => next);
      return;
    }
    Alert.alert('Finish session?', detail, [
      { text: 'Keep logging', style: 'cancel' },
      { text: 'Finish', onPress: () => void act(() => next) },
    ]);
  }

  function leaveSession() {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace('/(tabs)/plan');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <View style={styles.top}>
        <Pressable
          onPress={leaveSession}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <ArrowLeft color={colors.textPrimary} />
        </Pressable>
        <ApexBrand />
        <AccountButton style={styles.accountButton} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : (
        <>
          <ScrollView
            contentContainerStyle={styles.content}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.eyebrow}>WORKOUT SESSION</Text>
            <Text style={styles.title}>
              {loaded?.plan?.plan.name_snapshot ?? 'Workout'}
            </Text>
            <Text style={styles.sub}>
              {date ? formatDay(new Date(`${date}T12:00:00`)) : ''} ·{' '}
              {loaded?.plan?.plan.goal_snapshot ?? 'Workout'}
            </Text>
            {loaded?.plan || snapshot ? (
              <Text style={styles.sessionTotals}>
                {exerciseCount} exercises · {workingSetCount} working sets
              </Text>
            ) : null}
            {message ? <Text style={styles.message}>{message}</Text> : null}
            {loaded?.syncState === 'conflict' ? (
              <Pressable
                onPress={() => router.push('/conflicts')}
                accessibilityRole="button"
                style={styles.conflictLink}
              >
                <Text style={styles.message}>
                  This session has a sync conflict. Review both versions.
                </Text>
              </Pressable>
            ) : null}
            {!loaded?.plan && !snapshot ? (
              <Text style={styles.message}>
                This workout is not available in the saved plan. Open Plan while
                online, then try again.
              </Text>
            ) : null}
            <View style={styles.timerCard}>
              <View style={styles.timerLine}>
                <Clock3 color={colors.accent} size={26} />
                <Text style={styles.timer}>
                  {snapshot
                    ? formatTimer(activeMilliseconds(snapshot, now))
                    : '00:00:00'}
                </Text>
              </View>
              {!snapshot && loaded?.plan?.plan.status === 'planned' ? (
                <Pressable
                  style={styles.primary}
                  disabled={busy}
                  onPress={() =>
                    void act(() =>
                      startSnapshot(accountId!, loaded.plan!, stamp()),
                    )
                  }
                  accessibilityRole="button"
                >
                  <Play color={colors.textOnAccent} />
                  <Text style={styles.primaryText}>Start</Text>
                </Pressable>
              ) : snapshot?.session.status === 'in_progress' && editable ? (
                <Pressable
                  style={styles.primary}
                  disabled={busy}
                  onPress={() =>
                    void act(() =>
                      running
                        ? pauseSnapshot(snapshot!, stamp())
                        : resumeSnapshot(snapshot!, stamp()),
                    )
                  }
                  accessibilityRole="button"
                >
                  {running ? (
                    <Pause color={colors.textOnAccent} />
                  ) : (
                    <Play color={colors.textOnAccent} />
                  )}
                  <Text style={styles.primaryText}>
                    {running ? 'Pause' : 'Resume'}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            {snapshot &&
            snapshot.session.status !== 'in_progress' &&
            loaded?.syncState !== 'conflict' ? (
              <Pressable
                style={styles.editButton}
                onPress={() => {
                  if (editing) {
                    setEditing(false);
                    setEditBase(null);
                    void reload();
                  } else {
                    setEditBase(snapshot);
                    setEditing(true);
                  }
                }}
                accessibilityRole="button"
              >
                <Text style={styles.editText}>
                  {editing ? 'Cancel Edit' : 'Edit Session'}
                </Text>
              </Pressable>
            ) : null}
            {snapshot ? (
              <>
                <View style={styles.commentsCard}>
                  <Text style={styles.sectionTitle}>Workout Comments</Text>
                  <TextInput
                    multiline
                    maxLength={500}
                    value={comments}
                    onChangeText={setCommentsDraft}
                    onBlur={saveDrafts}
                    editable={editable}
                    placeholder="Add notes for this workout..."
                    placeholderTextColor={colors.textMuted}
                    style={styles.commentsInput}
                    accessibilityLabel="Workout comments"
                  />
                  <Text style={styles.count}>{comments.length} / 500</Text>
                </View>
                {snapshot.exercises.map((exercise, index) => (
                  <View key={exercise.id} style={styles.exercise}>
                    <Text style={styles.eyebrow}>EXERCISE #{index + 1}</Text>
                    <Text style={styles.exerciseName}>
                      {exercise.name_snapshot}
                    </Text>
                    <View style={styles.tableHead}>
                      <Text style={styles.setCol}>Set</Text>
                      <Text style={styles.numberCol}>Reps</Text>
                      <Text style={styles.numberCol}>Weight (kg)</Text>
                      <Text style={styles.noteCol}>Notes</Text>
                    </View>
                    {snapshot.sets
                      .filter((set) => set.session_exercise_id === exercise.id)
                      .sort((a, b) => a.set_number - b.set_number)
                      .map((set) => {
                        const draft = drafts[set.id] ?? {
                          reps: '',
                          weight: '',
                          notes: '',
                        };
                        const change = (values: Partial<SetDraft>) =>
                          setDrafts((current) => ({
                            ...current,
                            [set.id]: { ...draft, ...values },
                          }));
                        return (
                          <View key={set.id} style={styles.setBlock}>
                            <View style={styles.setRow}>
                              <Text style={styles.setBadge}>
                                {set.set_number}
                              </Text>
                              <TextInput
                                style={[styles.input, styles.numberInput]}
                                value={draft.reps}
                                onChangeText={(value) =>
                                  change({ reps: value })
                                }
                                onBlur={saveDrafts}
                                editable={editable}
                                keyboardType="number-pad"
                                accessibilityLabel={`Set ${set.set_number} reps`}
                              />
                              <TextInput
                                style={[styles.input, styles.numberInput]}
                                value={draft.weight}
                                onChangeText={(value) =>
                                  change({ weight: value })
                                }
                                onBlur={saveDrafts}
                                editable={editable}
                                keyboardType="decimal-pad"
                                accessibilityLabel={`Set ${set.set_number} weight in kilograms`}
                              />
                              <TextInput
                                style={[styles.input, styles.notesInput]}
                                value={draft.notes}
                                onChangeText={(value) =>
                                  change({ notes: value })
                                }
                                onBlur={saveDrafts}
                                editable={editable}
                                placeholder="Notes"
                                placeholderTextColor={colors.textMuted}
                                accessibilityLabel={`Set ${set.set_number} notes`}
                              />
                            </View>
                          </View>
                        );
                      })}
                    {editable ? (
                      <Pressable
                        style={styles.addButton}
                        disabled={busy}
                        onPress={() => {
                          const change = () =>
                            addSet(foldDrafts(snapshot), exercise.id, stamp());
                          if (editing) {
                            try {
                              setEditBase(change());
                            } catch (issue) {
                              setMessage(
                                issue instanceof Error
                                  ? issue.message
                                  : 'Could not add set.',
                              );
                            }
                          } else void act(change);
                        }}
                        accessibilityRole="button"
                      >
                        <Plus color={colors.accent} size={20} />
                        <Text style={styles.addText}>Add Set</Text>
                      </Pressable>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
          {editable ? (
            <Pressable
              style={styles.finish}
              disabled={busy}
              onPress={editing ? () => void saveEdits() : finish}
              accessibilityRole="button"
            >
              <CheckCircle2 color={colors.textOnAccent} size={27} />
              <Text style={styles.finishText}>
                {editing ? 'Save Changes' : 'Finish Session'}
              </Text>
            </Pressable>
          ) : null}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  editButton: {
    minHeight: sizing.touchTarget,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  editText: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
  },
  conflictLink: { minHeight: sizing.touchTarget, justifyContent: 'center' },
  safe: { flex: 1, backgroundColor: colors.background },
  top: {
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  accountButton: { right: spacing.lg },
  back: {
    position: 'absolute',
    top: 0,
    left: spacing.lg,
    zIndex: 1,
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
  },
  loader: { marginTop: spacing.xxl },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
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
    marginTop: spacing.xs,
  },
  sub: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    marginTop: spacing.sm,
  },
  sessionTotals: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
    marginTop: spacing.sm,
  },
  message: {
    color: colors.warning,
    marginTop: spacing.md,
    fontFamily: typography.family.regular,
  },
  timerCard: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
    gap: spacing.md,
  },
  timerLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  timer: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.title,
  },
  primary: {
    minHeight: 54,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  primaryText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  commentsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderLeftWidth: 5,
    borderLeftColor: colors.accent,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 20,
  },
  commentsInput: {
    marginTop: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    color: colors.textPrimary,
    minHeight: 76,
    textAlignVertical: 'top',
    padding: spacing.md,
    fontFamily: typography.family.regular,
  },
  count: { color: colors.textMuted, textAlign: 'right', marginTop: spacing.xs },
  exercise: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
  },
  exerciseName: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 22,
    marginTop: spacing.xs,
  },
  tableHead: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  setCol: {
    width: 40,
    flexShrink: 0,
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
  },
  numberCol: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    textAlign: 'center',
  },
  noteCol: {
    flex: 1.4,
    minWidth: 0,
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
  },
  setBlock: { marginBottom: spacing.sm },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    width: '100%',
  },
  setBadge: {
    width: 40,
    flexShrink: 0,
    overflow: 'hidden',
    textAlign: 'center',
    backgroundColor: colors.accent,
    color: colors.textOnAccent,
    borderRadius: radii.sm,
    fontFamily: typography.family.semibold,
    paddingVertical: spacing.sm,
  },
  input: {
    minHeight: sizing.touchTarget,
    minWidth: 0,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: typography.family.regular,
    paddingHorizontal: spacing.sm,
  },
  numberInput: { flex: 1, minWidth: 0, textAlign: 'center' },
  notesInput: { flex: 1.4, minWidth: 0 },
  addButton: {
    minHeight: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
  },
  addText: { color: colors.accent, fontFamily: typography.family.semibold },
  finish: {
    minHeight: 58,
    backgroundColor: colors.accent,
    borderRadius: radii.lg,
    margin: spacing.lg,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.md,
  },
  finishText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: 20,
  },
});
