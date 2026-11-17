import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Minus,
  Pause,
  Play,
  Plus,
} from 'lucide-react-native';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  deleteCachedRead,
  getCachedRead,
  saveCachedRead,
} from './sessionStore';
import {
  activeMilliseconds,
  addSet,
  removeLastSet,
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
type SessionDraftCache = {
  sessionId: string;
  drafts: Record<string, SetDraft>;
  comments: string;
};
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
  const [saveNotice, setSaveNotice] = useState<{
    exerciseId: string | null;
    text: string;
  } | null>(null);
  const [savingExerciseId, setSavingExerciseId] = useState<string | null>(null);
  const [savingEdits, setSavingEdits] = useState(false);
  const [now, setNow] = useState(stamp);
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>({});
  const draftsRef = useRef<Record<string, SetDraft>>({});
  const [comments, setCommentsDraft] = useState('');
  const commentsRef = useRef('');
  const [editing, setEditing] = useState(false);
  const [editBase, setEditBase] = useState<SessionSnapshot | null>(null);
  const busyRef = useRef(false);
  const draftKey = `session-draft:${id}`;

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
      const savedDraft =
        result.snapshot?.session.status === 'in_progress'
          ? await getCachedRead<SessionDraftCache>(accountId, draftKey).catch(
              () => null,
            )
          : null;
      const matchingDraft =
        savedDraft?.sessionId === result.snapshot?.session.id
          ? savedDraft
          : null;
      const nextDrafts = Object.fromEntries(
        (result.snapshot?.sets ?? []).map((set) => [
          set.id,
          matchingDraft?.drafts[set.id] ?? {
            reps: set.actual_reps === null ? '' : String(set.actual_reps),
            weight:
              set.actual_weight_kg === null ? '' : String(set.actual_weight_kg),
            notes: set.notes ?? '',
          },
        ]),
      );
      const nextComments =
        matchingDraft?.comments ?? result.snapshot?.session.comments ?? '';
      draftsRef.current = nextDrafts;
      commentsRef.current = nextComments;
      setLoaded(result);
      setDrafts(nextDrafts);
      setCommentsDraft(nextComments);
      setMessage(result.error);
      return result;
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not load session.',
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, id, date, status, draftKey]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(stamp()), 1000);
    return () => clearInterval(timer);
  }, []);

  const snapshot = editing
    ? (editBase ?? loaded?.snapshot ?? null)
    : (loaded?.snapshot ?? null);
  const editable = snapshot?.session.status === 'in_progress' || editing;
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

  async function persist(next: SessionSnapshot, keepCurrentEdit = false) {
    if (!accountId) return;
    const syncState = await persistWorkoutSession(
      accountId,
      next,
      status === 'signed_in',
      keepCurrentEdit,
    );
    setLoaded((current) =>
      current ? { ...current, snapshot: next, syncState } : current,
    );
    return syncState;
  }

  function showSaveError(error: unknown, fallback: string) {
    if (
      error instanceof Error &&
      error.message === 'Resolve this session conflict before editing it.'
    ) {
      setLoaded((current) =>
        current ? { ...current, syncState: 'conflict' } : current,
      );
      setMessage('Save your session edits to keep this workout version.');
      return;
    }
    setMessage(error instanceof Error ? error.message : fallback);
  }

  async function act(
    operation: () => SessionSnapshot,
    clearDraft = false,
    keepCurrentEdit = false,
  ): Promise<'clean' | 'pending' | false> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const syncState = await persist(operation(), keepCurrentEdit);
      if (clearDraft && accountId)
        await deleteCachedRead(accountId, draftKey).catch(() => {});
      return syncState ?? false;
    } catch (error) {
      showSaveError(error, 'Could not save session.');
      return false;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function rememberDraft(
    nextDrafts: Record<string, SetDraft>,
    nextComments: string,
    base = snapshot,
  ) {
    if (!accountId || !base || base.session.status !== 'in_progress') return;
    const changedDrafts = Object.fromEntries(
      base.sets
        .filter((set) => {
          const draft = nextDrafts[set.id];
          if (!draft) return false;
          const reps = draft.reps.trim();
          const weight = draft.weight.trim();
          const repsMatch = reps
            ? /^\d+$/.test(reps) && Number(reps) === set.actual_reps
            : set.actual_reps === null;
          const weightMatch = weight
            ? /^\d+(\.\d{1,2})?$/.test(weight) &&
              Number(weight) === set.actual_weight_kg
            : set.actual_weight_kg === null;
          return (
            !repsMatch ||
            !weightMatch ||
            (draft.notes.trim() || null) !== set.notes
          );
        })
        .map((set) => [set.id, nextDrafts[set.id]]),
    );
    const operation =
      Object.keys(changedDrafts).length ||
      nextComments !== (base.session.comments ?? '')
        ? saveCachedRead(accountId, draftKey, {
            sessionId: base.session.id,
            drafts: changedDrafts,
            comments: nextComments,
          } satisfies SessionDraftCache)
        : deleteCachedRead(accountId, draftKey);
    void operation.catch(() => {
      setMessage('Could not keep a local draft. Tap Save before leaving.');
    });
  }

  function foldDrafts(
    base: SessionSnapshot,
    exerciseId?: string,
  ): SessionSnapshot {
    let next = setComments(base, commentsRef.current, stamp());
    for (const set of base.sets) {
      if (exerciseId && set.session_exercise_id !== exerciseId) continue;
      const draft = draftsRef.current[set.id];
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

  async function saveExerciseDrafts(exerciseId: string) {
    if (!snapshot || !editable || busyRef.current) return;
    let next: SessionSnapshot;
    try {
      next = foldDrafts(snapshot, exerciseId);
      if (editing) next = saveEditedSnapshot(next, stamp());
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not save set entries.',
      );
      return;
    }
    setSavingExerciseId(exerciseId);
    setSaveNotice(null);
    const syncState = await act(() => next, false, true);
    setSavingExerciseId(null);
    if (!syncState) return;
    setSaveNotice({
      exerciseId,
      text:
        syncState === 'clean'
          ? 'Saved and synced.'
          : 'Saved on this device. Sync pending.',
    });
    if (editing) setEditBase(next);
    else rememberDraft(draftsRef.current, commentsRef.current, next);
  }

  async function beginEdit() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const latest = await reload();
      if (latest?.snapshot) {
        setEditBase(latest.snapshot);
        setEditing(true);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function saveEdits() {
    if (!snapshot || !editing || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setSavingEdits(true);
    setSaveNotice(null);
    setMessage(null);
    try {
      const syncState = await persist(
        saveEditedSnapshot(foldDrafts(snapshot), stamp()),
        true,
      );
      if (syncState)
        setSaveNotice({
          exerciseId: null,
          text:
            syncState === 'clean'
              ? 'Session changes saved and synced.'
              : 'Session changes saved on this device. Sync pending.',
        });
      if (accountId)
        await deleteCachedRead(accountId, draftKey).catch(() => {});
      setEditing(false);
      setEditBase(null);
    } catch (error) {
      showSaveError(error, 'Could not save session changes.');
    } finally {
      busyRef.current = false;
      setBusy(false);
      setSavingEdits(false);
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
      if (window.confirm(`Finish session?\n\n${detail}`))
        void act(() => next, true);
      return;
    }
    Alert.alert('Finish session?', detail, [
      { text: 'Keep logging', style: 'cancel' },
      { text: 'Finish', onPress: () => void act(() => next, true) },
    ]);
  }

  async function removeExerciseSet(exerciseId: string) {
    if (!snapshot || !editable || busyRef.current) return;
    const lastSet = snapshot.sets
      .filter((set) => set.session_exercise_id === exerciseId)
      .sort((a, b) => b.set_number - a.set_number)[0];
    if (!lastSet) return;
    const draft = draftsRef.current[lastSet.id];
    const hasEntries =
      lastSet.actual_reps !== null ||
      lastSet.actual_weight_kg !== null ||
      !!lastSet.notes ||
      !!draft?.reps ||
      !!draft?.weight ||
      !!draft?.notes;
    if (hasEntries) {
      const prompt = `Remove set ${lastSet.set_number} and its logged data?`;
      const confirmed =
        Platform.OS === 'web'
          ? window.confirm(prompt)
          : await new Promise<boolean>((resolve) =>
              Alert.alert('Remove Set', prompt, [
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
    }
    if (editing) {
      setEditBase(removeLastSet(snapshot, exerciseId, stamp()));
    } else {
      const saved = await act(
        () => removeLastSet(snapshot, exerciseId, stamp()),
        false,
        loaded?.syncState === 'conflict',
      );
      if (!saved) return;
    }
    const nextDrafts = { ...draftsRef.current };
    delete nextDrafts[lastSet.id];
    draftsRef.current = nextDrafts;
    setDrafts(nextDrafts);
    rememberDraft(nextDrafts, commentsRef.current);
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
            {saveNotice?.exerciseId === null ? (
              <Text style={styles.saveNotice} accessibilityLiveRegion="polite">
                {saveNotice.text}
              </Text>
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
              ) : snapshot?.session.status === 'in_progress' &&
                loaded?.syncState !== 'conflict' ? (
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
            {snapshot && snapshot.session.status !== 'in_progress' ? (
              <Pressable
                style={styles.editButton}
                onPress={() => {
                  if (editing) {
                    setEditing(false);
                    setEditBase(null);
                    void reload();
                  } else {
                    void beginEdit();
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
                    onChangeText={(value) => {
                      commentsRef.current = value;
                      setCommentsDraft(value);
                      setSaveNotice(null);
                      rememberDraft(draftsRef.current, value);
                    }}
                    editable={editable && !busy}
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
                      <Text style={[styles.numericHeading, styles.repsCol]}>
                        Reps
                      </Text>
                      <Text
                        style={[styles.numericHeading, styles.weightCol]}
                        numberOfLines={1}
                      >
                        Weight (kg)
                      </Text>
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
                        const change = (values: Partial<SetDraft>) => {
                          const nextDrafts = {
                            ...draftsRef.current,
                            [set.id]: {
                              ...(draftsRef.current[set.id] ?? draft),
                              ...values,
                            },
                          };
                          draftsRef.current = nextDrafts;
                          setDrafts(nextDrafts);
                          setSaveNotice(null);
                          rememberDraft(nextDrafts, commentsRef.current);
                        };
                        return (
                          <View key={set.id} style={styles.setBlock}>
                            <View style={styles.setRow}>
                              <Text style={styles.setBadge}>
                                {set.set_number}
                              </Text>
                              <TextInput
                                style={[
                                  styles.input,
                                  styles.numberInput,
                                  styles.repsInput,
                                ]}
                                value={draft.reps}
                                onChangeText={(value) =>
                                  change({ reps: value })
                                }
                                editable={editable && !busy}
                                keyboardType="number-pad"
                                accessibilityLabel={`Set ${set.set_number} reps`}
                              />
                              <TextInput
                                style={[
                                  styles.input,
                                  styles.numberInput,
                                  styles.weightInput,
                                ]}
                                value={draft.weight}
                                onChangeText={(value) =>
                                  change({ weight: value })
                                }
                                editable={editable && !busy}
                                keyboardType="decimal-pad"
                                accessibilityLabel={`Set ${set.set_number} weight in kilograms`}
                              />
                              <TextInput
                                style={[styles.input, styles.notesInput]}
                                value={draft.notes}
                                onChangeText={(value) =>
                                  change({ notes: value })
                                }
                                editable={editable && !busy}
                                placeholder="Notes"
                                placeholderTextColor={colors.textMuted}
                                accessibilityLabel={`Set ${set.set_number} notes`}
                              />
                            </View>
                          </View>
                        );
                      })}
                    {editable ? (
                      <>
                        <View style={styles.setActions}>
                          <Pressable
                            style={styles.addButton}
                            disabled={busy}
                            onPress={() => {
                              setSaveNotice(null);
                              const change = () =>
                                addSet(snapshot, exercise.id, stamp());
                              if (editing) setEditBase(change());
                              else
                                void act(
                                  change,
                                  false,
                                  loaded?.syncState === 'conflict',
                                );
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Add Set"
                          >
                            <Plus color={colors.accent} size={20} />
                            <Text style={styles.addText}>Add Set</Text>
                          </Pressable>
                          <Pressable
                            style={styles.removeButton}
                            disabled={
                              busy ||
                              !snapshot.sets.some(
                                (set) =>
                                  set.session_exercise_id === exercise.id,
                              )
                            }
                            onPress={() => {
                              setSaveNotice(null);
                              void removeExerciseSet(exercise.id);
                            }}
                            accessibilityRole="button"
                            accessibilityLabel="Remove last set"
                          >
                            <Minus color={colors.danger} size={20} />
                            <Text style={styles.removeText}>Remove Set</Text>
                          </Pressable>
                          <Pressable
                            style={({ pressed }) => [
                              styles.saveSetButton,
                              (pressed || savingExerciseId === exercise.id) &&
                                styles.savePressed,
                            ]}
                            disabled={busy}
                            onPress={() => void saveExerciseDrafts(exercise.id)}
                            accessibilityRole="button"
                            accessibilityLabel="Save session entries"
                          >
                            <Text style={styles.saveSetText}>
                              {savingExerciseId === exercise.id
                                ? 'Saving…'
                                : saveNotice?.exerciseId === exercise.id
                                  ? 'Saved'
                                  : 'Save'}
                            </Text>
                          </Pressable>
                        </View>
                        {saveNotice?.exerciseId === exercise.id ? (
                          <Text
                            style={styles.saveNotice}
                            accessibilityLiveRegion="polite"
                          >
                            {saveNotice.text}
                          </Text>
                        ) : null}
                      </>
                    ) : null}
                  </View>
                ))}
              </>
            ) : null}
          </ScrollView>
          {editable ? (
            <Pressable
              style={({ pressed }) => [
                styles.finish,
                (pressed || savingEdits) && styles.savePressed,
              ]}
              disabled={busy}
              onPress={editing ? () => void saveEdits() : finish}
              accessibilityRole="button"
            >
              <CheckCircle2 color={colors.textOnAccent} size={27} />
              <Text style={styles.finishText}>
                {savingEdits
                  ? 'Saving…'
                  : editing
                    ? 'Save Changes'
                    : 'Finish Session'}
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
  numericHeading: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    textAlign: 'center',
  },
  repsCol: { width: 44 },
  weightCol: { width: 80, marginLeft: -8, marginRight: -8, fontSize: 13 },
  noteCol: {
    flex: 1,
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
  numberInput: { textAlign: 'center' },
  repsInput: { width: 44 },
  weightInput: { width: 64 },
  notesInput: { flex: 1, minWidth: 0 },
  setActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  addButton: {
    minHeight: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addText: { color: colors.accent, fontFamily: typography.family.semibold },
  removeButton: {
    minHeight: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  removeText: { color: colors.danger, fontFamily: typography.family.semibold },
  saveSetButton: {
    minHeight: sizing.touchTarget,
    minWidth: 60,
    marginLeft: 'auto',
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveSetText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
  },
  savePressed: { opacity: 0.65 },
  saveNotice: {
    color: colors.success,
    fontFamily: typography.family.semibold,
    marginTop: spacing.sm,
  },
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
