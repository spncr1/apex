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

import type { PlanDetail } from '../../services/planningRepository';
import { colors, radii, sizing, spacing, typography } from '../../theme/tokens';
import type { PlannedWorkoutRow } from '../../types/database';

export type PlanAction =
  | { action: 'skip' }
  | { action: 'move'; date: string }
  | { action: 'swap'; other: PlannedWorkoutRow };

function dateValid(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00`);
  return (
    !Number.isNaN(date.getTime()) &&
    [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-') === value
  );
}

export function PlanActionSheet({
  plan,
  otherPlans,
  busy,
  error,
  onAction,
  onClose,
}: {
  plan: PlanDetail;
  otherPlans: PlannedWorkoutRow[];
  busy: boolean;
  error: string | null;
  onAction: (action: PlanAction) => void;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<'menu' | 'move' | 'swap'>('menu');
  const [date, setDate] = useState(plan.plan.planned_date);
  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.panel}>
          <Text style={styles.title}>{plan.plan.name_snapshot}</Text>
          <Text style={styles.meta}>
            {plan.plan.planned_date} · Dated workout
          </Text>
          <ScrollView
            style={styles.options}
            keyboardShouldPersistTaps="handled"
          >
            {mode === 'menu' ? (
              <>
                <ActionButton
                  label="Swap with another workout"
                  onPress={() => setMode('swap')}
                />
                <ActionButton
                  label="Move to another date"
                  onPress={() => setMode('move')}
                />
                <ActionButton
                  label="Skip this workout"
                  onPress={() => onAction({ action: 'skip' })}
                  danger
                />
              </>
            ) : null}
            {mode === 'swap' ? (
              <>
                <Text style={styles.meta}>
                  Choose a scheduled workout on another date.
                </Text>
                {otherPlans.length ? (
                  otherPlans.map((other) => (
                    <ActionButton
                      key={other.id}
                      label={`${other.name_snapshot} · ${other.planned_date}`}
                      onPress={() => onAction({ action: 'swap', other })}
                    />
                  ))
                ) : (
                  <Text style={styles.meta}>
                    No other scheduled workouts are available.
                  </Text>
                )}
              </>
            ) : null}
            {mode === 'move' ? (
              <>
                <Text style={styles.meta}>
                  Destination date (YYYY-MM-DD). Occupied dates are allowed.
                </Text>
                <TextInput
                  style={styles.input}
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor={colors.textMuted}
                  autoCapitalize="none"
                  accessibilityLabel="Move workout to date"
                />
                <ActionButton
                  label="Move workout"
                  disabled={!dateValid(date) || date === plan.plan.planned_date}
                  onPress={() => onAction({ action: 'move', date })}
                />
              </>
            ) : null}
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </ScrollView>
          <View style={styles.footer}>
            {mode !== 'menu' ? (
              <ActionButton
                label="Back to actions"
                onPress={() => setMode('menu')}
                subtle
              />
            ) : null}
            <ActionButton label="Cancel" onPress={onClose} subtle />
          </View>
          {busy ? <Text style={styles.meta}>Saving...</Text> : null}
        </View>
      </View>
    </Modal>
  );
}

function ActionButton({
  label,
  onPress,
  danger = false,
  subtle = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  subtle?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      style={[
        styles.button,
        subtle && styles.subtleButton,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
    >
      <Text
        style={[
          styles.buttonText,
          danger && styles.dangerText,
          subtle && styles.subtleText,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: colors.modalBackdrop,
  },
  panel: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    maxHeight: '85%',
  },
  title: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
    fontSize: 22,
  },
  meta: {
    color: colors.textMuted,
    fontFamily: typography.family.regular,
    fontSize: typography.size.label,
    marginTop: spacing.sm,
    marginBottom: spacing.md,
  },
  options: { maxHeight: 420 },
  button: {
    minHeight: sizing.touchTarget,
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  buttonText: {
    color: colors.textPrimary,
    fontFamily: typography.family.semibold,
  },
  dangerText: { color: colors.danger },
  subtleButton: { backgroundColor: colors.surface },
  subtleText: { color: colors.accent },
  disabled: { opacity: 0.5 },
  input: {
    minHeight: sizing.touchTarget,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    color: colors.textPrimary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  footer: { marginTop: spacing.md },
  error: {
    color: colors.danger,
    fontFamily: typography.family.regular,
    marginBottom: spacing.md,
  },
});
