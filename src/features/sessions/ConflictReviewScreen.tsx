import { useFocusEffect, useRouter } from 'expo-router';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  GitCompareArrows,
} from 'lucide-react-native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ScreenFrame } from '../../components/ScreenFrame';
import {
  loadConflictReviews,
  resolveConflict,
  restoreConflictCopy,
  type ConflictReview,
} from '../../services/conflictRepository';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import type { SessionSnapshot } from '../../types/database';
import { useAuth } from '../auth/AuthProvider';

function Version({
  title,
  snapshot,
}: {
  title: string;
  snapshot: SessionSnapshot;
}) {
  const logged = snapshot.sets.filter((set) => set.actual_reps !== null);
  return (
    <View style={styles.version}>
      <Text style={styles.versionTitle}>{title}</Text>
      <Text style={styles.meta}>
        {snapshot.session.status.replace('_', ' ')} ·{' '}
        {new Date(snapshot.session.started_at).toLocaleString('en-AU')}
      </Text>
      <Text style={styles.meta}>
        {logged.length} logged sets · {snapshot.exercises.length} exercises
      </Text>
      {snapshot.session.comments ? (
        <Text style={styles.body}>Comments: {snapshot.session.comments}</Text>
      ) : null}
      {snapshot.exercises.map((exercise) => (
        <View key={exercise.id} style={styles.exercise}>
          <Text style={styles.exerciseTitle}>{exercise.name_snapshot}</Text>
          {snapshot.sets
            .filter((set) => set.session_exercise_id === exercise.id)
            .sort((a, b) => a.set_number - b.set_number)
            .map((set) => (
              <Text key={set.id} style={styles.body}>
                Set {set.set_number} ·{' '}
                {set.set_type === 'warm_up' ? 'Warm-up' : 'Working'} ·{' '}
                {set.actual_reps ?? '-'} reps × {set.actual_weight_kg ?? '-'} kg
                {set.notes ? ` · ${set.notes}` : ''}
              </Text>
            ))}
        </View>
      ))}
    </View>
  );
}

export function ConflictReviewScreen() {
  const router = useRouter();
  const { accountId, status } = useAuth();
  const [reviews, setReviews] = useState<ConflictReview[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const offline = status === 'offline';

  const reload = useCallback(async () => {
    if (!accountId) return;
    setLoading(true);
    try {
      setReviews(await loadConflictReviews(accountId, offline));
      setMessage(null);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not load conflicts.',
      );
    } finally {
      setLoading(false);
    }
  }, [accountId, offline]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  async function choose(review: ConflictReview, choice: 'local' | 'remote') {
    if (!accountId || busy || offline) return;
    setBusy(true);
    try {
      const result = await resolveConflict(accountId, review, choice);
      setMessage(
        result === 'changed'
          ? 'The synced version changed. Review both versions again.'
          : 'Choice saved. The other version remains below as a recoverable copy.',
      );
      setReviews(await loadConflictReviews(accountId, false));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not resolve conflict.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function restore(review: ConflictReview) {
    if (!accountId || busy || offline) return;
    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(
            'Restore this saved session copy? The current version will remain in session history.',
          )
        : await new Promise<boolean>((resolve) =>
            Alert.alert(
              'Restore saved copy?',
              'The current version will remain in session history.',
              [
                {
                  text: 'Cancel',
                  style: 'cancel',
                  onPress: () => resolve(false),
                },
                { text: 'Restore', onPress: () => resolve(true) },
              ],
            ),
          );
    if (!confirmed) return;
    setBusy(true);
    try {
      await restoreConflictCopy(accountId, review);
      setMessage(
        'Saved copy restored. The prior version remains in session history.',
      );
      setReviews(await loadConflictReviews(accountId, false));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Could not restore copy.',
      );
    } finally {
      setBusy(false);
    }
  }

  const pending = reviews.filter((review) => review.status === 'pending');
  const resolved = reviews.filter((review) => review.status === 'resolved');

  return (
    <ScreenFrame
      eyebrow="SESSION SYNC"
      title="Review Conflicts"
      subtitle="Choose which workout log to keep. Both versions stay available for review."
    >
      <Pressable
        style={styles.back}
        onPress={() =>
          router.canGoBack() ? router.back() : router.replace('/(tabs)/plan')
        }
        accessibilityRole="button"
      >
        <ArrowLeft color={colors.accent} size={20} />
        <Text style={styles.backText}>Back</Text>
      </Pressable>
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {offline ? (
        <Text style={styles.message}>
          Reconnect to choose a version. Saved copies are still available below.
        </Text>
      ) : null}
      {loading ? <ActivityIndicator color={colors.accent} /> : null}
      {!loading && !reviews.length ? (
        <Text style={styles.meta}>No session conflicts.</Text>
      ) : null}
      {pending.map((review) => (
        <View key={review.conflictId} style={styles.card}>
          <View style={styles.heading}>
            <GitCompareArrows color={colors.accent} />
            <Text style={styles.headingText}>Needs your choice</Text>
          </View>
          <Text style={styles.meta}>
            {new Date(review.createdAt).toLocaleString('en-AU')}
          </Text>
          <Version title="This device" snapshot={review.localSnapshot} />
          <Version title="Synced version" snapshot={review.remoteSnapshot} />
          <View style={styles.buttons}>
            <Pressable
              style={[styles.choice, (busy || offline) && styles.disabled]}
              disabled={busy || offline}
              onPress={() => void choose(review, 'local')}
              accessibilityRole="button"
            >
              <Text style={styles.choiceText}>Keep this device</Text>
            </Pressable>
            <Pressable
              style={[styles.choice, (busy || offline) && styles.disabled]}
              disabled={busy || offline}
              onPress={() => void choose(review, 'remote')}
              accessibilityRole="button"
            >
              <Text style={styles.choiceText}>Keep synced</Text>
            </Pressable>
          </View>
        </View>
      ))}
      {resolved.length ? (
        <Text style={styles.sectionTitle}>Recoverable copies</Text>
      ) : null}
      {resolved.map((review) => (
        <View key={review.conflictId} style={styles.card}>
          <Pressable
            style={styles.heading}
            onPress={() =>
              setExpanded(
                expanded === review.conflictId ? null : review.conflictId,
              )
            }
            accessibilityRole="button"
            accessibilityLabel="Show recoverable session copy"
          >
            <Text style={styles.headingText}>
              {new Date(review.createdAt).toLocaleDateString('en-AU')} ·{' '}
              {review.choice === 'local' ? 'Synced copy' : 'Device copy'}
            </Text>
            {expanded === review.conflictId ? (
              <ChevronUp color={colors.accent} />
            ) : (
              <ChevronDown color={colors.accent} />
            )}
          </Pressable>
          {expanded === review.conflictId && review.rejectedSnapshot ? (
            <>
              <Version title="Saved copy" snapshot={review.rejectedSnapshot} />
              <Pressable
                style={[styles.restore, (busy || offline) && styles.disabled]}
                disabled={busy || offline}
                onPress={() => void restore(review)}
                accessibilityRole="button"
              >
                <Text style={styles.restoreText}>Restore this copy</Text>
              </Pressable>
            </>
          ) : null}
        </View>
      ))}
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  back: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    alignSelf: 'flex-start',
    marginBottom: spacing.lg,
  },
  backText: { color: colors.accent, fontFamily: typography.family.semibold },
  message: {
    color: colors.warning,
    fontFamily: typography.family.regular,
    marginBottom: spacing.lg,
  },
  card: {
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  heading: {
    minHeight: sizing.touchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  headingText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    flex: 1,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    marginBottom: spacing.sm,
  },
  version: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    marginTop: spacing.md,
  },
  versionTitle: {
    color: colors.accent,
    fontFamily: typography.family.semibold,
    fontSize: typography.size.body,
    marginBottom: spacing.xs,
  },
  exercise: { marginTop: spacing.md },
  exerciseTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    marginBottom: spacing.xs,
  },
  body: {
    color: colors.textPrimary,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    marginTop: spacing.xs,
  },
  buttons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  choice: {
    flex: 1,
    minHeight: sizing.touchTarget,
    backgroundColor: colors.accent,
    borderRadius: radii.md,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.sm,
  },
  choiceText: {
    color: colors.textOnAccent,
    fontFamily: typography.family.semibold,
    textAlign: 'center',
  },
  disabled: { opacity: 0.5 },
  restore: {
    minHeight: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.accent,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  restoreText: { color: colors.accent, fontFamily: typography.family.semibold },
  sectionTitle: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 20,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
});
