import { Tabs } from 'expo-router';
import {
  CalendarDays,
  ChartNoAxesCombined,
  Dumbbell,
  House,
  UsersRound,
} from 'lucide-react-native';
import { StyleSheet } from 'react-native';

import { colors, radii, spacing, typography } from '../../src/theme/tokens';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.bar,
        tabBarItemStyle: styles.item,
        tabBarLabelStyle: styles.label,
        tabBarActiveTintColor: colors.textOnAccent,
        tabBarInactiveTintColor: colors.textPrimary,
        tabBarActiveBackgroundColor: colors.accent,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
        }}
      />
      <Tabs.Screen
        name="plan"
        options={{
          title: 'Plan',
          tabBarIcon: ({ color, size }) => (
            <CalendarDays color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="exercises"
        options={{
          title: 'Exercises',
          tabBarIcon: ({ color, size }) => (
            <Dumbbell color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="progress"
        options={{
          title: 'Progress',
          tabBarIcon: ({ color, size }) => (
            <ChartNoAxesCombined color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="social"
        options={{
          title: 'Social',
          tabBarIcon: ({ color, size }) => (
            <UsersRound color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 82,
    marginHorizontal: spacing.sm,
    marginBottom: spacing.xl,
    paddingTop: spacing.xs,
    paddingBottom: spacing.xs,
    borderTopWidth: 1,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.background,
    position: 'absolute',
  },
  item: {
    borderRadius: radii.lg,
    overflow: 'hidden',
    marginHorizontal: spacing.xs,
    marginVertical: spacing.xs,
  },
  label: {
    fontFamily: typography.family.semibold,
    fontSize: 11,
    marginBottom: spacing.xs,
  },
});
