import { Check, Plus, Trash2, X } from 'lucide-react-native';
import { useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { ExerciseRow } from '../../types/database';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import type {
  ExerciseTargetInput,
  SetTargetInput,
} from '../../services/planningRepository';

export interface WorkoutEditorValue {
  name: string;
  goal: string;
  exercises: ExerciseTargetInput[];
}

type DraftSet = { reps: string; weight: string };
type DraftExercise = {
  exercise_id: string;
  name: string;
  sets: DraftSet[];
};

function fromTarget(set: SetTargetInput): DraftSet {
  return {
    reps: set.target_reps === null ? '' : String(set.target_reps),
    weight: set.target_weight_kg === null ? '' : String(set.target_weight_kg),
  };
}

export function WorkoutEditor({
  title,
  initial,
  catalog,
  onClose,
  onOpenExercise,
  onSave,
  visible = true,
}: {
  title: string;
  initial: WorkoutEditorValue;
  catalog: ExerciseRow[];
  onClose: () => void;
  onOpenExercise: (exerciseId: string) => void;
  onSave: (value: WorkoutEditorValue) => Promise<void>;
  visible?: boolean;
}) {
  const [name, setName] = useState(initial.name);
  const [goal, setGoal] = useState(initial.goal);
  const [exercises, setExercises] = useState<DraftExercise[]>(
    initial.exercises.map((exercise) => ({
      exercise_id: exercise.exercise_id,
      name: exercise.name,
      sets: exercise.sets.map(fromTarget),
    })),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredExercise, setHoveredExercise] = useState<string | null>(null);

  function changeSet(
    exerciseId: string,
    setIndex: number,
    change: Partial<DraftSet>,
  ) {
    setExercises((current) =>
      current.map((exercise) =>
        exercise.exercise_id === exerciseId
          ? {
              ...exercise,
              sets: exercise.sets.map((set, index) =>
                index === setIndex ? { ...set, ...change } : set,
              ),
            }
          : exercise,
      ),
    );
  }

  function addExercise(exercise: ExerciseRow) {
    setExercises((current) => [
      ...current,
      {
        exercise_id: exercise.id,
        name: exercise.name,
        sets: [{ reps: '', weight: '' }],
      },
    ]);
    setPickerOpen(false);
    setSearch('');
  }

  async function save() {
    if (saving) return;
    if (!name.trim()) {
      setError('Enter a workout name.');
      return;
    }
    if (!exercises.length) {
      setError('Add at least one exercise.');
      return;
    }
    const parsed: ExerciseTargetInput[] = [];
    for (const exercise of exercises) {
      const sets: SetTargetInput[] = [];
      for (const set of exercise.sets) {
        const reps = set.reps.trim() === '' ? null : Number(set.reps);
        const weight = set.weight.trim() === '' ? null : Number(set.weight);
        if (
          (reps !== null && (!Number.isInteger(reps) || reps < 0)) ||
          (weight !== null &&
            (!Number.isFinite(weight) || weight < 0 || weight > 999999.99))
        ) {
          setError('Use whole reps and a nonnegative weight when entered.');
          return;
        }
        sets.push({
          set_type: 'working',
          target_reps: reps,
          target_weight_kg: weight,
        });
      }
      parsed.push({
        exercise_id: exercise.exercise_id,
        name: exercise.name,
        sets,
      });
    }
    setSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        goal: goal.trim(),
        exercises: parsed,
      });
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : 'Could not save workout.',
      );
    } finally {
      setSaving(false);
    }
  }

  const available = catalog.filter(
    (exercise) =>
      !exercises.some((chosen) => chosen.exercise_id === exercise.id) &&
      exercise.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.page} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable
            style={styles.iconButton}
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close editor"
          >
            <X color={colors.textPrimary} />
          </Pressable>
          <Text style={styles.title}>{title}</Text>
          <Pressable
            style={styles.iconButton}
            onPress={() => void save()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save workout"
          >
            <Check color={colors.accent} />
          </Pressable>
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={styles.label}>Workout name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            style={styles.input}
            placeholder="e.g. Push"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Workout name"
          />
          <Text style={styles.label}>Goal label (optional)</Text>
          <TextInput
            value={goal}
            onChangeText={setGoal}
            style={styles.input}
            placeholder="e.g. Hypertrophy"
            placeholderTextColor={colors.textMuted}
            accessibilityLabel="Goal label"
          />
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionTitle}>Planned exercises</Text>
            <Pressable
              style={styles.addButton}
              onPress={() => setPickerOpen(true)}
              accessibilityRole="button"
              accessibilityLabel="Add exercise"
            >
              <Plus size={18} color={colors.textOnAccent} />
              <Text style={styles.addText}>Add</Text>
            </Pressable>
          </View>
          {exercises.map((exercise) => (
            <View key={exercise.exercise_id} style={styles.exerciseCard}>
              <View style={styles.exerciseHeading}>
                <Pressable
                  style={styles.exerciseNameLink}
                  onPress={() => onOpenExercise(exercise.exercise_id)}
                  onHoverIn={() => setHoveredExercise(exercise.exercise_id)}
                  onHoverOut={() => setHoveredExercise(null)}
                  accessibilityRole="link"
                  accessibilityLabel={`View ${exercise.name} exercise details`}
                >
                  <Text
                    style={[
                      styles.exerciseName,
                      styles.exerciseNameLinkText,
                      hoveredExercise === exercise.exercise_id &&
                        styles.exerciseNameHovered,
                    ]}
                  >
                    {exercise.name}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.iconButton}
                  onPress={() =>
                    setExercises((current) =>
                      current.filter(
                        (item) => item.exercise_id !== exercise.exercise_id,
                      ),
                    )
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${exercise.name}`}
                >
                  <Trash2 size={18} color={colors.textMuted} />
                </Pressable>
              </View>
              {exercise.sets.map((set, index) => (
                <View key={index} style={styles.setRow}>
                  <Text style={styles.setNumber}>{index + 1}</Text>
                  <TextInput
                    value={set.reps}
                    onChangeText={(value) =>
                      changeSet(exercise.exercise_id, index, { reps: value })
                    }
                    style={styles.numberInput}
                    keyboardType="number-pad"
                    accessibilityLabel={`${exercise.name} set ${index + 1} target reps`}
                  />
                  <Text style={styles.unit}>reps</Text>
                  <TextInput
                    value={set.weight}
                    onChangeText={(value) =>
                      changeSet(exercise.exercise_id, index, { weight: value })
                    }
                    style={styles.numberInput}
                    keyboardType="decimal-pad"
                    accessibilityLabel={`${exercise.name} set ${index + 1} target weight in kilograms`}
                  />
                  <Text style={styles.unit}>kg</Text>
                  {exercise.sets.length > 1 ? (
                    <Pressable
                      style={styles.iconButton}
                      onPress={() =>
                        setExercises((current) =>
                          current.map((item) =>
                            item.exercise_id === exercise.exercise_id
                              ? {
                                  ...item,
                                  sets: item.sets.filter(
                                    (_, setIndex) => setIndex !== index,
                                  ),
                                }
                              : item,
                          ),
                        )
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`Remove set ${index + 1}`}
                    >
                      <X size={17} color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <Pressable
                style={styles.addSet}
                onPress={() =>
                  setExercises((current) =>
                    current.map((item) =>
                      item.exercise_id === exercise.exercise_id
                        ? {
                            ...item,
                            sets: [...item.sets, { reps: '', weight: '' }],
                          }
                        : item,
                    ),
                  )
                }
                accessibilityRole="button"
                accessibilityLabel={`Add set to ${exercise.name}`}
              >
                <Plus size={17} color={colors.accent} />
                <Text style={styles.addSetText}>Add Set</Text>
              </Pressable>
            </View>
          ))}
          <Pressable
            style={[styles.saveButton, saving && styles.disabled]}
            onPress={() => void save()}
            disabled={saving}
            accessibilityRole="button"
            accessibilityLabel="Save workout"
          >
            <Text style={styles.saveText}>
              {saving ? 'Saving…' : 'Save Workout'}
            </Text>
          </Pressable>
        </ScrollView>
        <Modal
          visible={pickerOpen}
          transparent
          animationType="slide"
          onRequestClose={() => setPickerOpen(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.picker}>
              <View style={styles.exerciseHeading}>
                <Text style={styles.sectionTitle}>Choose exercise</Text>
                <Pressable
                  style={styles.iconButton}
                  onPress={() => setPickerOpen(false)}
                  accessibilityRole="button"
                  accessibilityLabel="Close exercise picker"
                >
                  <X color={colors.textPrimary} />
                </Pressable>
              </View>
              <TextInput
                value={search}
                onChangeText={setSearch}
                style={styles.input}
                placeholder="Search exercises"
                placeholderTextColor={colors.textMuted}
                accessibilityLabel="Search exercises"
              />
              <ScrollView keyboardShouldPersistTaps="handled">
                {available.map((exercise) => (
                  <Pressable
                    key={exercise.id}
                    style={styles.pickerRow}
                    onPress={() => addExercise(exercise)}
                    accessibilityRole="button"
                    accessibilityLabel={`Add ${exercise.name}`}
                  >
                    <Text style={styles.exerciseName}>{exercise.name}</Text>
                    <Plus size={18} color={colors.accent} />
                  </Pressable>
                ))}
                {!available.length ? (
                  <Text style={styles.hint}>No exercises available.</Text>
                ) : null}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
  iconButton: {
    width: sizing.touchTarget,
    height: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 19,
  },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  label: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.label,
    marginBottom: spacing.sm,
  },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    color: colors.textPrimary,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.lg,
  },
  hint: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    marginBottom: spacing.lg,
  },
  sectionHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 19,
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: sizing.touchTarget,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
  },
  addText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
  },
  exerciseCard: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  exerciseHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  exerciseName: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    flex: 1,
  },
  exerciseNameLink: {
    flex: 1,
    minHeight: sizing.touchTarget,
    justifyContent: 'center',
  },
  exerciseNameLinkText: { flex: 0 },
  exerciseNameHovered: {
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  setRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 48,
  },
  setNumber: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
    minWidth: 18,
  },
  numberInput: {
    width: 44,
    height: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    color: colors.textPrimary,
    textAlign: 'center',
    fontFamily: typography.family.regular,
  },
  unit: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: 11,
  },
  addSet: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  addSetText: { color: colors.accent, fontFamily: typography.family.semibold },
  error: {
    color: colors.danger,
    fontFamily: typography.family.regular,
    marginBottom: spacing.md,
  },
  saveButton: {
    minHeight: 52,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  saveText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  disabled: { opacity: 0.5 },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
  },
  picker: {
    height: '75%',
    backgroundColor: colors.background,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderColor: colors.border,
  },
});
