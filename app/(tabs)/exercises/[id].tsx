import { useLocalSearchParams } from 'expo-router';

import { MuscleGroupScreen } from '../../../src/features/muscle-groups/MuscleGroupScreen';

export default function MuscleGroupRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MuscleGroupScreen groupId={id} />;
}
