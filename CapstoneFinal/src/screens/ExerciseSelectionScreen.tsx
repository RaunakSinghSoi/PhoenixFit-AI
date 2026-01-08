import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';

export type ExerciseType = 'squat' | 'pushup' | 'deadlift';

type Props = NativeStackScreenProps<any>;

export default function ExerciseSelectionScreen({ navigation }: Props) {
  function go(exercise: ExerciseType) {
    navigation.navigate('RepTracking', { exercise });
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <Text style={styles.title}>Choose Exercise</Text>
        <Text style={styles.subtitle}>Vision-based rep tracking (no IMU required).</Text>

        <TouchableOpacity style={styles.card} onPress={() => go('squat')}>
          <Text style={styles.cardTitle}>Squat</Text>
          <Text style={styles.cardSubtitle}>Track squat reps and form in real time.</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => go('pushup')}>
          <Text style={styles.cardTitle}>Push Up</Text>
          <Text style={styles.cardSubtitle}>Count push ups and get basic coaching.</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.card} onPress={() => go('deadlift')}>
          <Text style={styles.cardTitle}>Deadlift</Text>
          <Text style={styles.cardSubtitle}>Monitor deadlift reps and technique cues.</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F7F9' },
  container: { flex: 1, padding: 16 },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 4 },
  subtitle: { fontSize: 13, color: '#6B7280', marginBottom: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: '#6B7280' },
});


