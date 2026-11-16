import { useLocalSearchParams } from 'expo-router';

import { ExerciseDetailScreen } from '../../../../src/features/exercises/ExerciseDetailScreen';

export default function ExerciseDetailRoute() {
  const { id, returnTo } = useLocalSearchParams<{
    id: string;
    returnTo?: 'plan' | 'progress';
  }>();
  return <ExerciseDetailScreen exerciseId={id} returnTo={returnTo} />;
}
