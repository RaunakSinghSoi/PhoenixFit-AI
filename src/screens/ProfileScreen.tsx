import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { doc, getDoc } from 'firebase/firestore';
import { signOut } from 'firebase/auth';
import { auth, firestore } from '../lib/firebase';

type DayType = 'Pull' | 'Push' | 'Legs' | 'Cardio' | 'Strength' | 'Full Body' | 'Rest';

const STORAGE_EXERCISES_BY_DATE = '@pfa_exercises_by_date_v1';
const STORAGE_DAYTYPE_BY_DATE = '@pfa_daytype_by_date_v1';

export default function ProfileScreen() {
  const user = auth.currentUser;
  const [displayName, setDisplayName] = React.useState<string | null>(user?.displayName || null);
  const [email, setEmail] = React.useState<string | null>(user?.email || null);
  const [highestStreak, setHighestStreak] = React.useState<number>(0);
  const [favoriteCategory, setFavoriteCategory] = React.useState<DayType | null>(null);

  React.useEffect(() => {
    void loadProfile();
  }, []);

  async function loadProfile() {
    const u = auth.currentUser;
    if (!u) return;

    try {
      const snap = await getDoc(doc(firestore, 'users', u.uid));
      if (snap.exists()) {
        const data: any = snap.data();
        if (data.displayName && !displayName) setDisplayName(String(data.displayName));
        if (data.email && !email) setEmail(String(data.email));
      }
    } catch {}

    try {
      const [rawExercises, rawDayTypes] = await Promise.all([
        AsyncStorage.getItem(STORAGE_EXERCISES_BY_DATE),
        AsyncStorage.getItem(STORAGE_DAYTYPE_BY_DATE),
      ]);
      const exercisesByDate: Record<string, any[]> = rawExercises ? JSON.parse(rawExercises) : {};
      const dayTypeByDate: Record<string, DayType> = rawDayTypes ? JSON.parse(rawDayTypes) : {};

      const dates = Object.keys(exercisesByDate).filter(d => (exercisesByDate[d]?.length || 0) > 0);
      setHighestStreak(calculateStreakFromDates(dates));
      setFavoriteCategory(computeFavoriteDayType(dayTypeByDate));
    } catch {}
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
        <View style={styles.card}>
          <Text style={styles.title}>Profile</Text>
          <Text style={styles.label}>Name</Text>
          <Text style={styles.value}>{displayName || '—'}</Text>
          <Text style={styles.label}>Email</Text>
          <Text style={styles.value}>{email || '—'}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.subtitle}>Your Stats</Text>
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{highestStreak}</Text>
              <Text style={styles.statLabel}>Best Streak (days)</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statNumber}>{favoriteCategory || '—'}</Text>
              <Text style={styles.statLabel}>Favorite Day Type</Text>
            </View>
          </View>
        </View>

        <View style={styles.footer}>
          <TouchableOpacity
            onPress={() => signOut(auth)}
            style={styles.signOutButton}
          >
            <Text style={styles.signOutText}>Sign Out</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

function calculateStreakFromDates(dateList: string[]): number {
  if (dateList.length === 0) return 0;
  const days = new Set(dateList);
  const sortedDays = Array.from(days).sort((a, b) => (a < b ? 1 : -1));
  let streak = 1;
  let cursor = sortedDays[0];
  while (true) {
    const prev = minusOneDay(cursor);
    if (days.has(prev)) {
      streak += 1;
      cursor = prev;
    } else {
      break;
    }
  }
  return streak;
}

function minusOneDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  dt.setUTCDate(dt.getUTCDate() - 1);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function computeFavoriteDayType(dayTypeByDate: Record<string, DayType>): DayType | null {
  const counts: Partial<Record<DayType, number>> = {};
  for (const dt of Object.values(dayTypeByDate)) {
    if (dt === 'Rest') continue;
    counts[dt] = (counts[dt] || 0) + 1;
  }
  let best: DayType | null = null;
  let bestCount = 0;
  (Object.keys(counts) as DayType[]).forEach((k) => {
    const c = counts[k] || 0;
    if (c > bestCount) {
      best = k;
      bestCount = c;
    }
  });
  return best;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F7F9' },
  container: { flex: 1, padding: 16 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  title: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 8 },
  subtitle: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 8 },
  label: { fontSize: 12, color: '#6B7280', marginTop: 8 },
  value: { fontSize: 16, color: '#111827', marginTop: 2 },
  statsRow: { flexDirection: 'row', marginTop: 4 },
  statBox: { flex: 1, paddingVertical: 8 },
  statNumber: { fontSize: 20, fontWeight: '800', color: '#111827' },
  statLabel: { fontSize: 12, color: '#6B7280', marginTop: 2 },
  footer: { marginTop: 'auto' },
  signOutButton: {
    borderRadius: 999,
    backgroundColor: '#111827',
    paddingVertical: 12,
    alignItems: 'center',
  },
  signOutText: { color: '#FFFFFF', fontWeight: '700' },
});


