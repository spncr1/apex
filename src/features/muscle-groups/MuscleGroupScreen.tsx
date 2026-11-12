import { useFocusEffect, useRouter } from 'expo-router';
import {
  ChevronLeft,
  ChevronRight,
  Dumbbell,
  Plus,
  Save,
  X,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getCachedRead, saveCachedRead } from '../sessions/sessionStore';
import { supabase } from '../../services/supabase';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import type {
  ExerciseRow,
  MuscleGroupRow,
  MuscleSubdivisionRow,
} from '../../types/database';
import { useAuth } from '../auth/AuthProvider';
import { AnatomyFigure } from '../exercises/AnatomyFigure';

type GroupData = {
  group: MuscleGroupRow;
  subdivisions: MuscleSubdivisionRow[];
  exercises: ExerciseRow[];
  notes: string;
};

function regionSubdivision(
  slug: string,
  subdivisions: MuscleSubdivisionRow[],
): string | null {
  const match =
    slug === 'abs'
      ? subdivisions.find((item) => item.name.toLowerCase().includes('rectus'))
      : slug === 'obliques'
        ? subdivisions.find((item) =>
            item.name.toLowerCase().includes('oblique'),
          )
        : null;
  return match?.id ?? null;
}

export function MuscleGroupScreen({
  groupId,
}: {
  groupId: string | undefined;
}) {
  const router = useRouter();
  const { accountId, status } = useAuth();
  const [data, setData] = useState<GroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedSubdivision, setSelectedSubdivision] = useState<string | null>(
    null,
  );
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [addingExercise, setAddingExercise] = useState(false);
  const [addingLabel, setAddingLabel] = useState(false);
  const [labelName, setLabelName] = useState('');
  const [exerciseName, setExerciseName] = useState('');
  const [exerciseSubdivision, setExerciseSubdivision] = useState<string | null>(
    null,
  );
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!accountId || !groupId) return;
      let active = true;
      setLoading(true);
      const load = async () => {
        const cached = await getCachedRead<GroupData>(
          accountId,
          `group:${groupId}`,
        ).catch(() => null);
        if (active && cached) {
          setData(cached);
          setNotesDraft(cached.notes);
        }
        if (status === 'offline' || !supabase) return;
        const [groupResult, subdivisionsResult, exercisesResult, noteResult] =
          await Promise.all([
            supabase
              .from('muscle_groups')
              .select('*')
              .eq('id', groupId)
              .maybeSingle(),
            supabase
              .from('muscle_subdivisions')
              .select('*')
              .eq('muscle_group_id', groupId)
              .order('name'),
            supabase
              .from('exercises')
              .select('*')
              .eq('muscle_group_id', groupId)
              .order('name'),
            supabase
              .from('muscle_group_notes')
              .select('notes')
              .eq('user_id', accountId)
              .eq('muscle_group_id', groupId)
              .maybeSingle(),
          ]);
        const queryError =
          groupResult.error ??
          subdivisionsResult.error ??
          exercisesResult.error ??
          noteResult.error;
        if (queryError) throw queryError;
        if (!groupResult.data) throw new Error('Muscle group not found.');
        const next: GroupData = {
          group: groupResult.data as MuscleGroupRow,
          subdivisions: (subdivisionsResult.data ??
            []) as MuscleSubdivisionRow[],
          exercises: (exercisesResult.data ?? []) as ExerciseRow[],
          notes: noteResult.data?.notes ?? '',
        };
        if (active) {
          setData(next);
          setNotesDraft(next.notes);
        }
        await saveCachedRead(accountId, `group:${groupId}`, next).catch(() => {
          if (active) setError('Offline copy could not be saved.');
        });
      };
      void load()
        .catch((issue: unknown) => {
          if (active)
            setError(
              issue instanceof Error
                ? issue.message
                : 'Could not load muscle group.',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [accountId, groupId, status]),
  );

  async function saveNotes() {
    if (!accountId || !data || !supabase || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { error: saveError } = await supabase
        .from('muscle_group_notes')
        .upsert(
          {
            user_id: accountId,
            muscle_group_id: data.group.id,
            notes: notesDraft.trim(),
          },
          { onConflict: 'user_id,muscle_group_id' },
        );
      if (saveError) throw saveError;
      const next = { ...data, notes: notesDraft.trim() };
      setData(next);
      await saveCachedRead(accountId, `group:${data.group.id}`, next).catch(
        () =>
          setError('Notes saved online, but the offline copy was not updated.'),
      );
      setEditingNotes(false);
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : 'Could not save notes.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveExercise() {
    if (!accountId || !data || !supabase || !exerciseName.trim() || saving)
      return;
    setSaving(true);
    setError(null);
    try {
      const { data: created, error: saveError } = await supabase
        .from('exercises')
        .insert({
          owner_id: accountId,
          muscle_group_id: data.group.id,
          muscle_subdivision_id: exerciseSubdivision,
          name: exerciseName.trim(),
        })
        .select('*')
        .single();
      if (saveError) throw saveError;
      const next = {
        ...data,
        exercises: [...data.exercises, created as ExerciseRow].sort((a, b) =>
          a.name.localeCompare(b.name),
        ),
      };
      setData(next);
      await (async () => {
        await saveCachedRead(accountId, `group:${data.group.id}`, next);
        const directoryCache = await getCachedRead<{
          groups: MuscleGroupRow[];
          exercises: ExerciseRow[];
        }>(accountId, 'catalog');
        if (directoryCache)
          await saveCachedRead(accountId, 'catalog', {
            ...directoryCache,
            exercises: [
              ...directoryCache.exercises,
              created as ExerciseRow,
            ].sort((a, b) => a.name.localeCompare(b.name)),
          });
      })().catch(() => {
        setError(
          'Exercise saved online, but its offline copy was not updated.',
        );
      });
      setAddingExercise(false);
      setExerciseName('');
      setExerciseSubdivision(null);
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : 'Could not save exercise.',
      );
    } finally {
      setSaving(false);
    }
  }

  async function saveLabel() {
    if (
      !accountId ||
      !data ||
      !supabase ||
      !labelName.trim() ||
      saving ||
      data.group.owner_id !== accountId
    )
      return;
    setSaving(true);
    setError(null);
    try {
      const { data: created, error: saveError } = await supabase
        .from('muscle_subdivisions')
        .insert({
          owner_id: accountId,
          muscle_group_id: data.group.id,
          name: labelName.trim(),
        })
        .select('*')
        .single();
      if (saveError) throw saveError;
      const next = {
        ...data,
        subdivisions: [
          ...data.subdivisions,
          created as MuscleSubdivisionRow,
        ].sort((a, b) => a.name.localeCompare(b.name)),
      };
      setData(next);
      await saveCachedRead(accountId, `group:${data.group.id}`, next).catch(
        () =>
          setError('Label saved online, but the offline copy was not updated.'),
      );
      setAddingLabel(false);
      setLabelName('');
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : 'Could not save label.',
      );
    } finally {
      setSaving(false);
    }
  }

  function chooseRegion(slug: string | null) {
    const subdivisionId =
      slug && data ? regionSubdivision(slug, data.subdivisions) : null;
    setSelectedSlug(subdivisionId ? slug : null);
    setSelectedSubdivision(subdivisionId);
  }

  const query = search.trim().toLocaleLowerCase();
  const exercises =
    data?.exercises.filter(
      (exercise) =>
        (!selectedSubdivision ||
          exercise.muscle_subdivision_id === selectedSubdivision) &&
        (!query || exercise.name.toLocaleLowerCase().includes(query)),
    ) ?? [];
  const interactiveSlugs =
    data?.group.name.toLowerCase() === 'abdominals'
      ? data.subdivisions.flatMap((item) =>
          item.name.toLowerCase().includes('rectus')
            ? ['abs']
            : item.name.toLowerCase().includes('oblique')
              ? ['obliques']
              : [],
        )
      : [];

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable
          style={styles.back}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Back to muscle groups"
        >
          <ChevronLeft color={colors.textPrimary} />
          <Text style={styles.backText}>Muscle Groups</Text>
        </Pressable>
        <View style={styles.eyebrowRow}>
          <View style={styles.mark} />
          <Text style={styles.eyebrow}>MUSCLE GROUP</Text>
        </View>
        <Text style={styles.title}>{data?.group.name ?? 'Muscle Group'}</Text>
        {status === 'offline' ? (
          <Text style={styles.notice}>Showing saved data.</Text>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {loading && !data ? <ActivityIndicator color={colors.accent} /> : null}
        {data ? (
          <>
            <AnatomyFigure
              groupName={data.group.name}
              selectedSlug={selectedSlug}
              interactiveSlugs={interactiveSlugs}
              onSelectSlug={chooseRegion}
            />
            <View style={styles.notesCard}>
              <Text style={styles.sectionTitle}>Muscle Group Notes</Text>
              {editingNotes ? (
                <>
                  <TextInput
                    multiline
                    value={notesDraft}
                    onChangeText={setNotesDraft}
                    style={styles.notesInput}
                    placeholder="Add notes for this muscle group"
                    placeholderTextColor={colors.textMuted}
                    accessibilityLabel="Muscle group notes"
                  />
                  <Pressable
                    style={styles.saveNotes}
                    onPress={() => void saveNotes()}
                    disabled={saving || status === 'offline'}
                    accessibilityRole="button"
                  >
                    <Save size={18} color={colors.accent} />
                    <Text style={styles.actionText}>Save Notes</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  style={styles.notesView}
                  onPress={() => setEditingNotes(true)}
                  disabled={status === 'offline'}
                  accessibilityRole="button"
                  accessibilityLabel="Edit muscle group notes"
                >
                  <Text style={styles.notesText}>
                    {data.notes || 'Add notes for this muscle group'}
                  </Text>
                </Pressable>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.filterRow}
            >
              <Pressable
                style={[
                  styles.filter,
                  !selectedSubdivision && styles.filterActive,
                ]}
                onPress={() => {
                  setSelectedSubdivision(null);
                  setSelectedSlug(null);
                }}
                accessibilityRole="button"
              >
                <Text
                  style={[
                    styles.filterText,
                    !selectedSubdivision && styles.filterTextActive,
                  ]}
                >
                  All
                </Text>
              </Pressable>
              {data.subdivisions.map((item) => (
                <Pressable
                  key={item.id}
                  style={[
                    styles.filter,
                    selectedSubdivision === item.id && styles.filterActive,
                  ]}
                  onPress={() => {
                    setSelectedSubdivision(item.id);
                    setSelectedSlug(null);
                  }}
                  accessibilityRole="button"
                >
                  <Text
                    style={[
                      styles.filterText,
                      selectedSubdivision === item.id &&
                        styles.filterTextActive,
                    ]}
                  >
                    {item.name}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
            {data.group.owner_id === accountId && status !== 'offline' ? (
              <Pressable
                style={styles.addLabel}
                onPress={() => setAddingLabel(true)}
                accessibilityRole="button"
                accessibilityLabel="Add group label"
              >
                <Plus size={17} color={colors.accent} />
                <Text style={styles.actionText}>Add Label</Text>
              </Pressable>
            ) : null}
            <View style={styles.exerciseHeading}>
              <Text style={styles.sectionTitle}>
                {selectedSubdivision
                  ? data.subdivisions.find(
                      (item) => item.id === selectedSubdivision,
                    )?.name
                  : data.group.name}{' '}
                Exercises ({exercises.length})
              </Text>
              <Pressable
                onPress={() => setAddingExercise(true)}
                disabled={status === 'offline'}
                style={styles.addButton}
                accessibilityRole="button"
                accessibilityLabel="Add exercise"
              >
                <Plus size={17} color={colors.textOnAccent} />
                <Text style={styles.addButtonText}>Add</Text>
              </Pressable>
            </View>
            <TextInput
              value={search}
              onChangeText={setSearch}
              placeholder="Search exercises"
              placeholderTextColor={colors.textMuted}
              style={styles.searchInput}
              accessibilityLabel="Search exercises"
            />
            {exercises.length ? (
              exercises.map((exercise) => (
                <Pressable
                  key={exercise.id}
                  style={styles.exerciseRow}
                  onPress={() =>
                    router.push({
                      pathname: '/(tabs)/exercises/detail/[id]',
                      params: { id: exercise.id },
                    })
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${exercise.name}`}
                >
                  <Dumbbell size={21} color={colors.accent} />
                  <Text style={styles.exerciseName}>{exercise.name}</Text>
                  <ChevronRight size={20} color={colors.textPrimary} />
                </Pressable>
              ))
            ) : (
              <Text style={styles.empty}>No exercises in this view.</Text>
            )}
          </>
        ) : null}
      </ScrollView>
      <Modal
        visible={addingExercise}
        transparent
        animationType="slide"
        onRequestClose={() => setAddingExercise(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeading}>
              <Text style={styles.modalTitle}>Add Exercise</Text>
              <Pressable
                onPress={() => setAddingExercise(false)}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X color={colors.textPrimary} />
              </Pressable>
            </View>
            <TextInput
              value={exerciseName}
              onChangeText={setExerciseName}
              style={styles.notesInput}
              placeholder="Exercise name"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Exercise name"
            />
            {data?.subdivisions.length ? (
              <View style={styles.modalFilters}>
                <Pressable
                  style={[
                    styles.filter,
                    !exerciseSubdivision && styles.filterActive,
                  ]}
                  onPress={() => setExerciseSubdivision(null)}
                >
                  <Text style={styles.filterText}>Whole group</Text>
                </Pressable>
                {data.subdivisions.map((item) => (
                  <Pressable
                    key={item.id}
                    style={[
                      styles.filter,
                      exerciseSubdivision === item.id && styles.filterActive,
                    ]}
                    onPress={() => setExerciseSubdivision(item.id)}
                  >
                    <Text style={styles.filterText}>{item.name}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={styles.modalSave}
              onPress={() => void saveExercise()}
              disabled={saving || !exerciseName.trim()}
              accessibilityRole="button"
            >
              <Text style={styles.modalSaveText}>
                {saving ? 'Saving…' : 'Save Exercise'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal
        visible={addingLabel}
        transparent
        animationType="slide"
        onRequestClose={() => setAddingLabel(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeading}>
              <Text style={styles.modalTitle}>Add Group Label</Text>
              <Pressable
                onPress={() => setAddingLabel(false)}
                style={styles.close}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X color={colors.textPrimary} />
              </Pressable>
            </View>
            <TextInput
              value={labelName}
              onChangeText={setLabelName}
              style={styles.notesInput}
              placeholder="Label name"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Group label name"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              style={styles.modalSave}
              onPress={() => void saveLabel()}
              disabled={saving || !labelName.trim()}
              accessibilityRole="button"
            >
              <Text style={styles.modalSaveText}>
                {saving ? 'Saving…' : 'Save Label'}
              </Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  content: { width: '100%', padding: spacing.lg, paddingBottom: 100 },
  back: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizing.touchTarget,
    marginBottom: spacing.lg,
  },
  backText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  mark: {
    width: 5,
    height: 20,
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  eyebrow: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
    letterSpacing: 2,
    fontSize: typography.size.label,
  },
  title: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.hero,
    marginTop: spacing.sm,
    marginBottom: spacing.lg,
  },
  notice: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    marginBottom: spacing.md,
  },
  error: {
    color: colors.danger,
    fontFamily: typography.family.regular,
    marginBottom: spacing.md,
  },
  notesCard: {
    borderWidth: 1,
    borderLeftWidth: 5,
    borderLeftColor: colors.accent,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    marginBottom: spacing.xl,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 19,
  },
  notesView: {
    minHeight: sizing.touchTarget,
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  notesText: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
  },
  notesInput: {
    color: colors.textPrimary,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.background,
    padding: spacing.md,
    minHeight: 52,
    marginTop: spacing.md,
  },
  saveNotes: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizing.touchTarget,
    marginTop: spacing.sm,
  },
  actionText: { color: colors.accent, fontFamily: typography.family.semibold },
  filterRow: { gap: spacing.sm, marginBottom: spacing.xl },
  addLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizing.touchTarget,
    marginTop: -spacing.lg,
    marginBottom: spacing.lg,
  },
  filter: {
    minHeight: sizing.touchTarget,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: {
    color: colors.textMuted,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  filterTextActive: { color: colors.textOnAccent },
  exerciseHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizing.touchTarget,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  addButtonText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
  },
  searchInput: {
    color: colors.textPrimary,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  exerciseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: 54,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    marginBottom: spacing.sm,
  },
  exerciseName: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    flex: 1,
  },
  empty: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
  },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  modalPanel: {
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  modalHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 22,
  },
  close: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginVertical: spacing.lg,
  },
  modalSave: {
    minHeight: 50,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  modalSaveText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
});
