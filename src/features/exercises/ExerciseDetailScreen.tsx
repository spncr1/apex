import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowLeft,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Dumbbell,
  FileText,
  History,
  Pencil,
  Save,
  X,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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
  loadExerciseDetail,
  saveExerciseNotes,
  type ExerciseDetailLoad,
} from '../../services/exerciseDetailRepository';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import type { LoggedSetRow } from '../../types/database';
import { useAuth } from '../auth/AuthProvider';
import { formatDay } from '../home/dates';
import { bestForHistory, loggedSetsFor } from './exerciseHistory';

const displayDate = (stamp: string) => {
  const date = new Date(stamp);
  return `${formatDay(date)} ${date.getFullYear()}`;
};
const weightLabel = (value: number) =>
  `${Number.isInteger(value) ? value : value.toFixed(2)} kg`;

function SetTable({ sets }: { sets: LoggedSetRow[] }) {
  return (
    <View style={styles.table}>
      <View style={styles.tableRow}>
        <Text style={[styles.tableHeading, styles.setColumn]}>Set</Text>
        <Text style={[styles.tableHeading, styles.repsColumn]}>Reps</Text>
        <Text style={[styles.tableHeading, styles.weightColumn]}>
          Weight (kg)
        </Text>
        <Text style={[styles.tableHeading, styles.notesColumn]}>Notes</Text>
      </View>
      {sets.map((set) => (
        <View key={set.id} style={styles.tableRow}>
          <View style={styles.setColumn}>
            <Text style={styles.setBadge}>{set.set_number}</Text>
          </View>
          <View style={[styles.cell, styles.repsColumn]}>
            <Text style={styles.cellText}>{set.actual_reps ?? '-'}</Text>
          </View>
          <View style={[styles.cell, styles.weightColumn]}>
            <Text style={styles.cellText}>{set.actual_weight_kg ?? '-'}</Text>
          </View>
          <View style={[styles.cell, styles.notesColumn]}>
            <Text style={styles.noteText} numberOfLines={2}>
              {set.notes || (set.set_type === 'warm_up' ? 'Warm-up' : '-')}
            </Text>
          </View>
        </View>
      ))}
    </View>
  );
}

export function ExerciseDetailScreen({
  exerciseId,
  returnTo,
}: {
  exerciseId: string | undefined;
  returnTo?: 'plan' | 'progress';
}) {
  const router = useRouter();
  const { accountId, status } = useAuth();
  const [detail, setDetail] = useState<ExerciseDetailLoad | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [versions, setVersions] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!accountId || !exerciseId) return;
      let active = true;
      setLoading(true);
      setDetail(null);
      setEditing(false);
      void loadExerciseDetail(accountId, exerciseId, status === 'offline')
        .then((result) => {
          if (!active) return;
          setDetail(result);
          setNotes(result.notes);
          setError(result.error);
          setExpanded(result.history[0]?.session.id ?? null);
        })
        .catch((issue: unknown) => {
          if (active)
            setError(
              issue instanceof Error
                ? issue.message
                : 'Could not load exercise.',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [accountId, exerciseId, status]),
  );

  async function saveNotes() {
    if (!accountId || !detail || saving || status === 'offline') return;
    setSaving(true);
    setError(null);
    try {
      const cleaned = notes.trim();
      await saveExerciseNotes(accountId, detail, cleaned);
      setDetail({ ...detail, notes: cleaned });
      setEditing(false);
    } catch (issue) {
      setError(
        issue instanceof Error
          ? issue.message
          : 'Could not save exercise notes.',
      );
    } finally {
      setSaving(false);
    }
  }

  const best = detail ? bestForHistory(detail.history) : null;
  const last = detail?.history[0];
  const shown = all ? detail?.history : detail?.history.slice(0, 3);

  function goBack() {
    if (router.canGoBack()) {
      router.back();
    } else if (returnTo === 'plan') {
      router.replace('/(tabs)/plan');
    } else if (returnTo === 'progress') {
      router.replace('/(tabs)/progress');
    } else {
      router.replace('/(tabs)/exercises');
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.top}>
          <Pressable
            onPress={goBack}
            style={styles.back}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <ArrowLeft color={colors.textPrimary} />
          </Pressable>
          <ApexBrand />
          <AccountButton />
        </View>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={styles.loader} />
        ) : detail ? (
          <>
            <View style={styles.eyebrowRow}>
              <View style={styles.mark} />
              <Text style={styles.eyebrow}>EXERCISE</Text>
            </View>
            <Text style={styles.title}>{detail.exercise.name}</Text>
            <Pressable
              style={styles.groupPill}
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/exercises/[id]',
                  params: { id: detail.group.id },
                })
              }
              accessibilityRole="button"
            >
              <Dumbbell color={colors.accent} size={20} />
              <Text style={styles.groupText}>{detail.group.name}</Text>
              <ChevronRight color={colors.textPrimary} size={20} />
            </Pressable>
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <View style={styles.stats}>
              <View style={styles.statCard}>
                <Dumbbell color={colors.accent} size={28} />
                <Text style={styles.statTitle}>Best Weight</Text>
                <Text style={styles.statValue}>
                  {best
                    ? `${weightLabel(best.weightKg)} × ${best.reps} reps`
                    : 'No result yet'}
                </Text>
                <Text style={styles.statSub}>
                  {best ? displayDate(best.date) : 'Log a working set'}
                </Text>
              </View>
              <View style={styles.statCard}>
                <CalendarDays color={colors.accent} size={28} />
                <Text style={styles.statTitle}>Last Worked</Text>
                <Text style={styles.statValue}>
                  {last
                    ? displayDate(
                        last.session.finished_at ?? last.session.started_at,
                      )
                    : 'Not yet'}
                </Text>
                <Text style={styles.statSub}>
                  {last?.workoutName ?? 'No session logged'}
                </Text>
              </View>
            </View>
            <View style={styles.notesCard}>
              <View style={styles.sectionHead}>
                <FileText color={colors.accent} />
                <Text style={styles.sectionTitle}>Exercise Notes</Text>
                {!editing ? (
                  <Pressable
                    onPress={() => {
                      setNotes(detail.notes);
                      setEditing(true);
                    }}
                    disabled={status === 'offline'}
                    style={styles.iconButton}
                    accessibilityRole="button"
                    accessibilityLabel="Edit exercise notes"
                  >
                    <Pencil color={colors.textPrimary} size={20} />
                  </Pressable>
                ) : null}
              </View>
              {editing ? (
                <>
                  <TextInput
                    value={notes}
                    onChangeText={setNotes}
                    multiline
                    maxLength={2000}
                    style={styles.notesInput}
                    placeholder="Add exercise setup and technique notes"
                    placeholderTextColor={colors.textMuted}
                    accessibilityLabel="Exercise notes"
                  />
                  <View style={styles.noteActions}>
                    <Pressable
                      onPress={() => {
                        setNotes(detail.notes);
                        setEditing(false);
                      }}
                      style={styles.smallButton}
                      accessibilityRole="button"
                    >
                      <X color={colors.textPrimary} size={18} />
                      <Text style={styles.smallText}>Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void saveNotes()}
                      disabled={saving}
                      style={[styles.smallButton, styles.saveButton]}
                      accessibilityRole="button"
                    >
                      <Save color={colors.textOnAccent} size={18} />
                      <Text style={styles.saveText}>
                        {saving ? 'Saving…' : 'Save'}
                      </Text>
                    </Pressable>
                  </View>
                </>
              ) : (
                <Text style={styles.notesText}>
                  {detail.notes || 'Add notes for this exercise.'}
                </Text>
              )}
              {status === 'offline' ? (
                <Text style={styles.muted}>
                  Connect to edit exercise notes.
                </Text>
              ) : null}
            </View>
            <View style={styles.historyCard}>
              <View style={styles.sectionHead}>
                <History color={colors.accent} />
                <Text style={styles.sectionTitle}>Session History</Text>
                {detail.history.length > 3 ? (
                  <Pressable
                    onPress={() => setAll(!all)}
                    style={styles.seeAll}
                    accessibilityRole="button"
                  >
                    <Text style={styles.link}>
                      {all ? 'Show Less' : 'See All'}
                    </Text>
                    <ChevronRight color={colors.accent} size={18} />
                  </Pressable>
                ) : null}
              </View>
              {!detail.history.length ? (
                <Text style={styles.muted}>No logged performances yet.</Text>
              ) : (
                shown?.map((item) => (
                  <View key={item.session.id} style={styles.historyEntry}>
                    <Pressable
                      onPress={() =>
                        setExpanded(
                          expanded === item.session.id ? null : item.session.id,
                        )
                      }
                      style={styles.historyHeader}
                      accessibilityRole="button"
                      accessibilityState={{
                        expanded: expanded === item.session.id,
                      }}
                    >
                      <Dumbbell color={colors.accent} size={22} />
                      <Text style={styles.historyTitle} numberOfLines={2}>
                        {`${item.workoutName} (${displayDate(
                          item.session.finished_at ?? item.session.started_at,
                        )})`}
                      </Text>
                      {expanded === item.session.id ? (
                        <ChevronUp color={colors.textPrimary} />
                      ) : (
                        <ChevronDown color={colors.textPrimary} />
                      )}
                    </Pressable>
                    {expanded === item.session.id ? (
                      <View style={styles.historyBody}>
                        {item.syncState === 'pending' ? (
                          <Text style={styles.muted}>Waiting to sync</Text>
                        ) : null}
                        <SetTable sets={item.sets} />
                        <Pressable
                          style={styles.sessionLink}
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
                        >
                          <Text style={styles.link}>Open Session</Text>
                          <ChevronRight color={colors.accent} size={18} />
                        </Pressable>
                        {item.previousVersions.length ? (
                          <>
                            <Pressable
                              style={styles.versionButton}
                              onPress={() =>
                                setVersions(
                                  versions === item.session.id
                                    ? null
                                    : item.session.id,
                                )
                              }
                              accessibilityRole="button"
                            >
                              <Text style={styles.muted}>
                                Earlier saved versions (
                                {item.previousVersions.length})
                              </Text>
                              {versions === item.session.id ? (
                                <ChevronUp color={colors.textMuted} size={18} />
                              ) : (
                                <ChevronDown
                                  color={colors.textMuted}
                                  size={18}
                                />
                              )}
                            </Pressable>
                            {versions === item.session.id
                              ? item.previousVersions.map((version) => (
                                  <View key={version.id} style={styles.version}>
                                    <Text style={styles.versionTitle}>
                                      Version {version.revision} ·{' '}
                                      {displayDate(version.saved_at)}
                                    </Text>
                                    <SetTable
                                      sets={loggedSetsFor(
                                        version.snapshot,
                                        detail.exercise.id,
                                      )}
                                    />
                                  </View>
                                ))
                              : null}
                          </>
                        ) : null}
                      </View>
                    ) : null}
                  </View>
                ))
              )}
            </View>
          </>
        ) : (
          <Text style={styles.error}>{error ?? 'Exercise not found.'}</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: 80 },
  top: {
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  back: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: 1,
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loader: { marginTop: spacing.xxl },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: {
    width: 5,
    height: 23,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  eyebrow: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
    letterSpacing: 2,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.hero,
    marginTop: spacing.sm,
  },
  groupPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
    minHeight: sizing.touchTarget,
    marginTop: spacing.lg,
  },
  groupText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
  },
  error: { color: colors.warning, marginTop: spacing.md },
  stats: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xxl },
  statCard: {
    flex: 1,
    minWidth: 0,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.xs,
  },
  statTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
  },
  statValue: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
    fontSize: 19,
  },
  statSub: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: 13,
  },
  notesCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderLeftWidth: 5,
    borderLeftColor: colors.accent,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  sectionHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 20,
    flex: 1,
  },
  iconButton: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notesText: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    lineHeight: 23,
    marginTop: spacing.md,
  },
  notesInput: {
    color: colors.textPrimary,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: 'top',
    marginTop: spacing.md,
    fontFamily: typography.family.regular,
  },
  noteActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  smallButton: {
    minHeight: sizing.touchTarget,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  smallText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
  },
  saveButton: { backgroundColor: colors.accent, borderColor: colors.accent },
  saveText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
  },
  historyCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginTop: spacing.lg,
  },
  seeAll: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
  },
  link: { color: colors.accent, fontFamily: typography.family.semibold },
  muted: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    marginTop: spacing.sm,
  },
  historyEntry: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    marginTop: spacing.md,
    overflow: 'hidden',
  },
  historyHeader: {
    minHeight: 54,
    paddingHorizontal: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceElevated,
  },
  historyTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    flex: 1,
  },
  historyBody: { padding: spacing.md },
  table: { gap: spacing.xs, marginTop: spacing.sm },
  tableRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    alignItems: 'center',
    minHeight: 40,
  },
  tableHeading: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    textAlign: 'center',
    fontSize: 12,
  },
  setColumn: { width: 38 },
  repsColumn: { width: 50 },
  weightColumn: { width: 80 },
  notesColumn: { flex: 1 },
  setBadge: {
    color: colors.textOnAccent,
    backgroundColor: colors.accent,
    borderRadius: radii.sm,
    overflow: 'hidden',
    textAlign: 'center',
    paddingVertical: spacing.xs,
    fontFamily: typography.family.semibold,
  },
  cell: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    minHeight: 35,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xs,
  },
  cellText: {
    color: colors.textPrimary,
    textAlign: 'center',
    fontFamily: typography.family.regular,
  },
  noteText: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    alignSelf: 'stretch',
  },
  sessionLink: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  versionButton: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  version: {
    marginTop: spacing.md,
    padding: spacing.sm,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.sm,
  },
  versionTitle: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
  },
});
