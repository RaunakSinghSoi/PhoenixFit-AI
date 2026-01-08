import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ExerciseSelectionScreen from '../screens/ExerciseSelectionScreen';
import RepTrackingScreen from '../screens/RepTrackingScreen';

export type WorkoutStackParamList = {
  ExerciseSelection: undefined;
  RepTracking: { exercise: 'squat' | 'pushup' | 'deadlift' };
};

const Stack = createNativeStackNavigator<WorkoutStackParamList>();

export default function WorkoutStack() {
  return (
    <Stack.Navigator id="workout-stack" screenOptions={{ headerShown: false }}>
      <Stack.Screen name="ExerciseSelection" component={ExerciseSelectionScreen} />
      <Stack.Screen name="RepTracking" component={RepTrackingScreen} />
    </Stack.Navigator>
  );
}


