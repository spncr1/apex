import { useLocalSearchParams } from 'expo-router';

import { ExerciseDetailScreen } from '../../../src/features/exercises/ExerciseDetailScreen';

export default function SessionExerciseDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ExerciseDetailScreen exerciseId={id} returnTo="plan" />;
}
