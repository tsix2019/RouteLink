import { StyleSheet, Text, View } from 'react-native';

export default function Placeholder() {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>RouteLink</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 34, fontWeight: '700' },
});
