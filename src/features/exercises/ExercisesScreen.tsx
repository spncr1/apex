import { useFocusEffect, useRouter } from 'expo-router';
import { ChevronRight, Dumbbell, Plus, Search, X } from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import { getCachedRead, saveCachedRead } from '../sessions/sessionStore';
import { supabase } from '../../services/supabase';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import type { ExerciseRow, MuscleGroupRow } from '../../types/database';
import { useAuth } from '../auth/AuthProvider';

interface CatalogSnapshot {
  groups: MuscleGroupRow[];
  exercises: ExerciseRow[];
}

export function ExercisesScreen() {
  const router = useRouter();
  const { accountId, status } = useAuth();
  const [catalog, setCatalog] = useState<CatalogSnapshot | null>(null);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [addGroup, setAddGroup] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!accountId) return;
      let active = true;
      setLoading(true);
      const load = async () => {
        const cached = await getCachedRead<CatalogSnapshot>(
          accountId,
          'catalog',
        ).catch(() => null);
        if (active && cached) setCatalog(cached);
        if (status === 'offline' || !supabase) return;
        const [groupsResult, exercisesResult] = await Promise.all([
          supabase.from('muscle_groups').select('*').order('name'),
          supabase.from('exercises').select('*').order('name'),
        ]);
        if (groupsResult.error || exercisesResult.error) {
          throw new Error(
            groupsResult.error?.message ?? exercisesResult.error?.message,
          );
        }
        const next = {
          groups: ((groupsResult.data ?? []) as MuscleGroupRow[]).sort((a, b) =>
            a.name.localeCompare(b.name),
          ),
          exercises: (exercisesResult.data ?? []) as ExerciseRow[],
        };
        if (active) setCatalog(next);
        await saveCachedRead(accountId, 'catalog', next).catch(() => {
          if (active) setError('Offline copy could not be saved.');
        });
      };
      void load()
        .catch((issue: unknown) => {
          if (active)
            setError(
              issue instanceof Error
                ? issue.message
                : 'Could not load exercises.',
            );
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [accountId, status]),
  );

  const query = search.trim().toLocaleLowerCase();
  async function saveEntry() {
    const cleaned = name.trim();
    if (!cleaned || !accountId || !supabase || saving) return;
    setSaving(true);
    setError(null);
    try {
      const { data, error: insertError } = await supabase
        .from('muscle_groups')
        .insert({ owner_id: accountId, name: cleaned })
        .select('*')
        .single();
      if (insertError) throw insertError;
      const next = {
        groups: [...(catalog?.groups ?? []), data as MuscleGroupRow].sort(
          (a, b) => a.name.localeCompare(b.name),
        ),
        exercises: catalog?.exercises ?? [],
      };
      setCatalog(next);
      await Promise.all([
        saveCachedRead(accountId, 'catalog', next),
        saveCachedRead(accountId, `group:${data.id}`, {
          group: data,
          subdivisions: [],
          exercises: [],
          notes: '',
        }),
      ]).catch(() => {
        setError(
          'Group saved online, but its offline copy could not be saved.',
        );
      });
      setAddGroup(false);
      setName('');
    } catch (issue) {
      setError(
        issue instanceof Error ? issue.message : 'Could not save entry.',
      );
    } finally {
      setSaving(false);
    }
  }

  function closeModal() {
    setAddGroup(false);
    setName('');
  }

  const groups = (catalog?.groups ?? []).filter((group) => {
    if (!query) return true;
    return (
      group.name.toLocaleLowerCase().includes(query) ||
      catalog?.exercises.some(
        (exercise) =>
          exercise.muscle_group_id === group.id &&
          exercise.name.toLocaleLowerCase().includes(query),
      )
    );
  });
  return (
    <ScreenFrame
      eyebrow="EXERCISES"
      title="Muscle Groups"
      subtitle="Browse muscle groups and their exercises."
    >
      <View style={styles.searchActions}>
        <View style={styles.searchBox}>
          <Search size={21} color={colors.textMuted} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search muscle groups or exercises"
            placeholderTextColor={colors.textMuted}
            style={styles.searchInput}
            accessibilityLabel="Search muscle groups or exercises"
          />
        </View>
        <Pressable
          disabled={status === 'offline'}
          style={[
            styles.addGroupButton,
            status === 'offline' && styles.disabled,
          ]}
          onPress={() => {
            setName('');
            setAddGroup(true);
          }}
          accessibilityRole="button"
          accessibilityLabel="Add muscle group"
        >
          <Plus size={21} color={colors.textOnAccent} />
          <Text style={styles.addGroupText}>Add Group</Text>
        </Pressable>
      </View>
      {status === 'offline' ? (
        <Text style={styles.notice}>Showing saved exercises.</Text>
      ) : null}
      {error ? <Text style={styles.notice}>{error}</Text> : null}
      {loading && !catalog ? <ActivityIndicator color={colors.accent} /> : null}
      {!loading && !groups.length ? (
        <Text style={styles.empty}>
          {query ? 'No matching muscle groups.' : 'No muscle groups yet.'}
        </Text>
      ) : null}
      {groups.map((group) => {
        const exercises =
          catalog?.exercises.filter(
            (exercise) => exercise.muscle_group_id === group.id,
          ) ?? [];
        return (
          <Pressable
            key={group.id}
            style={styles.groupCard}
            onPress={() => router.push(`/(tabs)/exercises/${group.id}`)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${group.name} muscle group`}
          >
            <Dumbbell size={25} color={colors.accent} />
            <Text style={styles.groupName}>{group.name}</Text>
            <Text style={styles.groupCount}>{exercises.length} exercises</Text>
            <ChevronRight size={21} color={colors.textPrimary} />
          </Pressable>
        );
      })}
      <Modal
        visible={addGroup}
        transparent
        animationType="slide"
        onRequestClose={closeModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalPanel}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Add Muscle Group</Text>
              <Pressable
                style={styles.closeButton}
                onPress={closeModal}
                accessibilityRole="button"
                accessibilityLabel="Close"
              >
                <X color={colors.textPrimary} />
              </Pressable>
            </View>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Group name"
              placeholderTextColor={colors.textMuted}
              style={styles.nameInput}
              accessibilityLabel="Group name"
              autoFocus
            />
            {error ? <Text style={styles.notice}>{error}</Text> : null}
            <Pressable
              style={[
                styles.saveButton,
                (!name.trim() || saving) && styles.disabled,
              ]}
              onPress={() => void saveEntry()}
              disabled={!name.trim() || saving}
              accessibilityRole="button"
              accessibilityLabel="Save entry"
            >
              <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  searchActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xl,
  },
  searchBox: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 48,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    color: colors.textPrimary,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    paddingVertical: spacing.sm,
  },
  addGroupButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: sizing.touchTarget,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  addGroupText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
  disabled: { opacity: 0.5 },
  notice: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    marginBottom: spacing.md,
  },
  empty: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    textAlign: 'center',
    padding: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
  },
  groupCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minWidth: 0,
    minHeight: 58,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  groupName: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 18,
    flex: 1,
    minWidth: 0,
  },
  groupCount: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    flexShrink: 1,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    justifyContent: 'flex-end',
  },
  modalPanel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    paddingBottom: spacing.xxl,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  modalTitle: {
    flex: 1,
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 22,
  },
  closeButton: {
    minHeight: sizing.touchTarget,
    minWidth: sizing.touchTarget,
    alignItems: 'center',
    justifyContent: 'center',
  },
  nameInput: {
    color: colors.textPrimary,
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    minHeight: 50,
    paddingHorizontal: spacing.md,
    fontFamily: typography.family.regular,
    fontSize: typography.size.body,
    marginBottom: spacing.lg,
  },
  saveButton: {
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: radii.md,
  },
  saveText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
  },
});
