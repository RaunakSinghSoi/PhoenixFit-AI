import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { enableScreens } from 'react-native-screens';
import Ionicons from '@expo/vector-icons/Ionicons';
import WorkoutStack from './WorkoutStack';
import ProgressScreen from '../screens/ProgressScreen';
import NutritionScreen from '../screens/NutritionScreen';
import ProfileScreen from '../screens/ProfileScreen';

enableScreens(true);

type TabParamList = {
  Workout: undefined;
  Progress: undefined;
  Nutrition: undefined;
  Profile: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

export default function AppTabs() {
  return (
    <Tab.Navigator
      // Some @react-navigation type combos require `id` but constrain it to `undefined`.
      // Explicitly passing `undefined` satisfies the type without affecting runtime behavior.
      id={undefined}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarActiveTintColor: '#111827',
        tabBarInactiveTintColor: '#9CA3AF',
        tabBarStyle: { height: 64, paddingBottom: 10, paddingTop: 8, borderTopWidth: 0 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarIcon: ({ color, size, focused }) => {
          const name =
            route.name === 'Workout' ? (focused ? 'barbell' : 'barbell-outline') :
            route.name === 'Progress' ? (focused ? 'calendar' : 'calendar-outline') :
            route.name === 'Nutrition' ? (focused ? 'restaurant' : 'restaurant-outline') :
            route.name === 'Profile' ? (focused ? 'person' : 'person-outline') :
            'ellipse';
          return <Ionicons name={name as any} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Workout" component={WorkoutStack} />
      <Tab.Screen name="Progress" component={ProgressScreen} />
      <Tab.Screen name="Nutrition" component={NutritionScreen} />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}


