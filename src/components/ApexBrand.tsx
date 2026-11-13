import { StyleSheet, View } from 'react-native';

import { spacing } from '../theme/tokens';
import { ApexLogo } from './ApexLogo';

export function ApexBrand() {
  return (
    <View style={styles.container}>
      <ApexLogo height={120} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    marginBottom: spacing.md,
  },
});
