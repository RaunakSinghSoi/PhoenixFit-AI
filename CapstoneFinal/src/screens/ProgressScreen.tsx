import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  Platform,
  Pressable,
  KeyboardAvoidingView,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Calendar } from 'react-native-calendars';
import Ionicons from '@expo/vector-icons/Ionicons';

type DayType = 'Pull' | 'Push' | 'Legs' | 'Cardio' | 'Strength' | 'Full Body' | 'Rest';

type Exercise = {
  id: string;
  name: string;
  sets?: number;
  repsPerSet?: number;
  minutes?: number;
  notes?: string;
};

// Legacy workout type for back-compat display
type LegacyWorkout = {
  id: string;
  dateISO: string;
  exercise: string;
  sets: number;
  repsPerSet: number;
  notes?: string;
};

const LEGACY_STORAGE_KEY = '@phoenixfitai_workouts_v1';
const STORAGE_LEGACY_MIGRATED = '@pfa_legacy_migrated_v1';
const STORAGE_EXERCISES_BY_DATE = '@pfa_exercises_by_date_v1';
const STORAGE_DAYTYPE_BY_DATE = '@pfa_daytype_by_date_v1';

const DAY_TYPE_COLORS: Record<DayType, string> = {
  Pull: '#6366F1',
  Push: '#EF4444',
  Legs: '#10B981',
  Cardio: '#F59E0B',
  Strength: '#8B5CF6',
  'Full Body': '#06B6D4',
  Rest: '#9CA3AF',
};

type CalDateObject = { dateString: string };

export default function ProgressScreen() {
  const [selectedDate, setSelectedDate] = React.useState<string>(getTodayISO());
  const [exercisesByDate, setExercisesByDate] = React.useState<Record<string, Exercise[]>>({});
  const [dayTypeByDate, setDayTypeByDate] = React.useState<Record<string, DayType>>({});

  const [exerciseModalVisible, setExerciseModalVisible] = React.useState(false);
  const [isEditing, setIsEditing] = React.useState(false);
  const [editingContext, setEditingContext] = React.useState<{ date: string; id: string } | null>(null);
  const [exerciseForm, setExerciseForm] = React.useState({
    name: '',
    sets: '3',
    repsPerSet: '10',
    minutes: '',
    notes: '',
  });

  React.useEffect(() => {
    void bootstrap();
  }, []);

  async function bootstrap() {
    try {
      const [rawExercises, rawDayTypes, rawLegacy, legacyMigrated] = await Promise.all([
        AsyncStorage.getItem(STORAGE_EXERCISES_BY_DATE),
        AsyncStorage.getItem(STORAGE_DAYTYPE_BY_DATE),
        AsyncStorage.getItem(LEGACY_STORAGE_KEY),
        AsyncStorage.getItem(STORAGE_LEGACY_MIGRATED),
      ]);

      const parsedExercises: Record<string, Exercise[]> = rawExercises ? JSON.parse(rawExercises) : {};
      const parsedDayTypes: Record<string, DayType> = rawDayTypes ? JSON.parse(rawDayTypes) : {};

      // Soft-import legacy items as exercises(display only). No destructive migration.
      if (rawLegacy && legacyMigrated !== 'true') {
        try {
          const legacy: LegacyWorkout[] = JSON.parse(rawLegacy);
          for (const w of legacy) {
            const date = sanitizeISO(w.dateISO) || getTodayISO();
            const arr = parsedExercises[date] ?? [];
            const newId = `legacy_${w.id}`;
            if (!arr.some(x => x.id === newId)) {
              arr.push({
                id: newId,
                name: w.exercise,
                sets: w.sets,

                repsPerSet: w.repsPerSet,
                notes: w.notes,
              });
              parsedExercises[date] = arr;
            }
          }
          try { await AsyncStorage.setItem(STORAGE_EXERCISES_BY_DATE, JSON.stringify(parsedExercises)); } catch {}
          try { await AsyncStorage.setItem(STORAGE_LEGACY_MIGRATED, 'true'); } catch {}
        } catch {}
      }

      setExercisesByDate(parsedExercises);
      setDayTypeByDate(parsedDayTypes);
    } catch {}
  }

  // Count unique days with at least one entry as "total workouts"
  const totalWorkouts = React.useMemo(() => {
    const dates = Object.keys(exercisesByDate);
    let count = 0;
    for (const d of dates) if ((exercisesByDate[d]?.length || 0) > 0) count++;
    return count;
  }, [exercisesByDate]);

  const streak = React.useMemo(() => calculateStreakFromDates(Object.keys(exercisesByDate)), [exercisesByDate]);

  const markedDates = React.useMemo(() => buildMarkedDates(selectedDate, exercisesByDate, dayTypeByDate), [selectedDate, exercisesByDate, dayTypeByDate]);

  const exercisesToday = exercisesByDate[selectedDate] ?? [];
  const selectedDayType = dayTypeByDate[selectedDate];

  // Recent section removed per request

  function onDayPress(day: CalDateObject) {
    setSelectedDate(day.dateString);
  }

  function openExerciseModal() {
    setIsEditing(false);
    setEditingContext(null);
    setExerciseForm({ name: '', sets: '3', repsPerSet: '10', minutes: '', notes: '' });
    setExerciseModalVisible(true);
  }

  function openEditModal(date: string, ex: Exercise) {
    setIsEditing(true);
    setEditingContext({ date, id: ex.id });
    setExerciseForm({
      name: ex.name ?? '',
      sets: ex.sets != null ? String(ex.sets) : '',
      repsPerSet: ex.repsPerSet != null ? String(ex.repsPerSet) : '',
      minutes: ex.minutes != null ? String(ex.minutes) : '',
      notes: ex.notes ?? '',
    });
    setExerciseModalVisible(true);
  }

  function closeExerciseModal() {
    setExerciseModalVisible(false);
  }

  function onExerciseChange<K extends keyof typeof exerciseForm>(key: K, value: (typeof exerciseForm)[K]) {
    setExerciseForm(prev => ({ ...prev, [key]: value }));
  }

  async function persistExercises(next: Record<string, Exercise[]>) {
    setExercisesByDate(next);
    try { await AsyncStorage.setItem(STORAGE_EXERCISES_BY_DATE, JSON.stringify(next)); } catch {}
  }

  async function persistDayTypes(next: Record<string, DayType>) {
    setDayTypeByDate(next);
    try { await AsyncStorage.setItem(STORAGE_DAYTYPE_BY_DATE, JSON.stringify(next)); } catch {}
  }

  async function addExercise() {
    if (!exerciseForm.name.trim()) return;
    const exercise: Exercise = {
      id: String(Date.now()) + '_' + Math.random().toString(36).slice(2, 8),
      name: exerciseForm.name.trim(),
      sets: safeInt(exerciseForm.sets),
      repsPerSet: safeInt(exerciseForm.repsPerSet),
      minutes: safeInt(exerciseForm.minutes),
      notes: exerciseForm.notes.trim() || undefined,
    };
    const next = { ...exercisesByDate };
    const arr = [...(next[selectedDate] ?? [])];
    arr.push(exercise);
    next[selectedDate] = arr;
    await persistExercises(next);
    closeExerciseModal();
  }

  async function saveEditedExercise() {
    if (!editingContext) return;
    if (!exerciseForm.name.trim()) return;
    const { date, id } = editingContext;
    const next = { ...exercisesByDate };
    const arr = [...(next[date] ?? [])];
    const idx = arr.findIndex(x => x.id === id);
    if (idx >= 0) {
      const updated: Exercise = {
        id,
        name: exerciseForm.name.trim(),
        sets: safeInt(exerciseForm.sets),
        repsPerSet: safeInt(exerciseForm.repsPerSet),
        minutes: safeInt(exerciseForm.minutes),
        notes: exerciseForm.notes.trim() || undefined,
      };
      arr[idx] = updated;
      next[date] = arr;
      await persistExercises(next);
    }
    closeExerciseModal();
  }

  async function removeExercise(id: string) {
    await removeExerciseForDate(selectedDate, id);
  }

  async function removeExerciseForDate(dateISO: string, id: string) {
    const next = { ...exercisesByDate };
    const arr = (next[dateISO] ?? []).filter(x => x.id !== id);
    if (arr.length === 0) delete next[dateISO]; else next[dateISO] = arr;
    await persistExercises(next);
  }

  async function setDayType(type: DayType) {
    const next = { ...dayTypeByDate, [selectedDate]: type };
    await persistDayTypes(next);
  }

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container}>
      <ScrollView contentContainerStyle={{ paddingBottom: 120 }}>
      <View style={styles.header}>
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{totalWorkouts}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statDivider} />
        <View style={styles.statBox}>
          <Text style={styles.statNumber}>{streak}</Text>
          <Text style={styles.statLabel}>Day Streak</Text>
        </View>
      </View>

      <View style={styles.calendarCard}>
        <Calendar
          onDayPress={onDayPress}
          markedDates={markedDates}
          theme={{
            calendarBackground: '#FFFFFF',
            textDayFontWeight: '600',
            textMonthFontWeight: '800',
            textDayHeaderFontWeight: '700',
            selectedDayBackgroundColor: '#111827',
            selectedDayTextColor: '#FFFFFF',
            todayTextColor: '#111827',
            arrowColor: '#111827',
          }}
          style={styles.calendar}
        />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{formatPrettyDate(selectedDate)}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {(['Pull','Push','Legs','Cardio','Strength','Full Body','Rest'] as DayType[]).map(dt => (
            <TouchableOpacity
              key={dt}
              onPress={() => setDayType(dt)}
              style={[styles.chip, selectedDayType === dt && { backgroundColor: DAY_TYPE_COLORS[dt] }]}
              activeOpacity={0.8}
            >
              <Text style={[styles.chipText, selectedDayType === dt && styles.chipTextSelected]}>{dt}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      <View style={styles.section}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Day Log</Text>
          <TouchableOpacity onPress={openExerciseModal} style={[styles.button, styles.primaryButton]}>
            <Text style={styles.buttonText}>Add Workout</Text>
          </TouchableOpacity>
        </View>

        {exercisesToday.length === 0 ? (
          <View style={styles.emptyStateSmall}>
            <Text style={styles.emptySubtitle}>No exercises logged for this day.</Text>
          </View>
        ) : (
          <View style={{ paddingBottom: 8 }}>
            {exercisesToday.map(item => (
              <View key={item.id} style={styles.card}>
                <View style={styles.cardHeader}>
                  <Text style={styles.cardTitle}>{item.name}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <TouchableOpacity onPress={() => openEditModal(selectedDate, item)} style={{ marginRight: 16 }}>
                      <Text style={{ color: '#111827', fontWeight: '700' }}>Edit</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => removeExercise(item.id)}>
                      <Text style={styles.deleteText}>Remove</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.cardMeta}>
                  {item.sets ? `${item.sets} sets` : ''}
                  {item.sets && item.repsPerSet ? ' × ' : ''}
                  {item.repsPerSet ? `${item.repsPerSet} reps` : ''}
                  {!item.sets && !item.repsPerSet && item.minutes ? `${item.minutes} min` : ''}
                </Text>
                {item.notes ? <Text style={styles.cardNotes}>{item.notes}</Text> : null}
              </View>
            ))}
          </View>
        )}
      </View>

      </ScrollView>
      <TouchableOpacity style={styles.fab} onPress={openExerciseModal} activeOpacity={0.8}>
        <Ionicons name="add" size={28} color="#FFFFFF" />
      </TouchableOpacity>

      <Modal visible={exerciseModalVisible} animationType="slide" onRequestClose={closeExerciseModal} transparent>
        <View style={styles.modalRoot} pointerEvents="box-none">
          <Pressable style={styles.modalBackdrop} onPress={closeExerciseModal} />
          <KeyboardAvoidingView
            behavior={Platform.select({ ios: 'padding', android: undefined })}
            style={styles.modalContainer}
            pointerEvents="box-none"
          >
            <Pressable style={styles.modalCard} onPress={() => {}}>
            <Text style={styles.modalTitle}>{isEditing ? 'Edit Workout' : 'Add Workout'}</Text>
            <ScrollView contentContainerStyle={styles.form} keyboardShouldPersistTaps="handled">
              <Text style={styles.inputLabel}>Name</Text>
              <TextInput
                placeholder="Squats / Running / Push Ups"
                value={exerciseForm.name}
                onChangeText={t => onExerciseChange('name', t)}
                style={styles.input}
              />

              <View style={styles.row}>
                <View style={styles.rowItem}>
                  <Text style={styles.inputLabel}>Sets</Text>
                  <TextInput
                    placeholder="3"
                    value={exerciseForm.sets}
                    onChangeText={t => onExerciseChange('sets', t.replace(/[^0-9]/g, ''))}
                    style={styles.input}
                    keyboardType="number-pad"
                  />
                </View>
                <View style={styles.rowSpacer} />
                <View style={styles.rowItem}>
                  <Text style={styles.inputLabel}>Reps/Set</Text>
                  <TextInput
                    placeholder="10"
                    value={exerciseForm.repsPerSet}
                    onChangeText={t => onExerciseChange('repsPerSet', t.replace(/[^0-9]/g, ''))}
                    style={styles.input}
                    keyboardType="number-pad"
                  />
                </View>
              </View>

              <Text style={styles.inputLabel}>Minutes (for cardio)</Text>
              <TextInput
                placeholder="20"
                value={exerciseForm.minutes}
                onChangeText={t => onExerciseChange('minutes', t.replace(/[^0-9]/g, ''))}
                style={styles.input}
                keyboardType="number-pad"
              />

              <Text style={styles.inputLabel}>Notes (optional)</Text>
              <TextInput
                placeholder="Felt strong today"
                value={exerciseForm.notes}
                onChangeText={t => onExerciseChange('notes', t)}
                style={[styles.input, styles.notesInput]}
                multiline
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <TouchableOpacity onPress={closeExerciseModal} style={[styles.button, styles.secondaryButton]}>
                <Text style={[styles.buttonText, styles.secondaryButtonText]}>Cancel</Text>
              </TouchableOpacity>
              {isEditing ? (
                <TouchableOpacity onPress={saveEditedExercise} style={[styles.button, styles.primaryButton]}>
                  <Text style={styles.buttonText}>Save Changes</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity onPress={addExercise} style={[styles.button, styles.primaryButton]}>
                  <Text style={styles.buttonText}>Save Workout</Text>
                </TouchableOpacity>
              )}
            </View>
            </Pressable>
          </KeyboardAvoidingView>
        </View>
      </Modal>

      </View>
    </SafeAreaView>
  );
}

function getTodayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function sanitizeISO(input: string): string | null {
  const m = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T12:00:00Z`);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function safeInt(value: string): number | undefined {
  const n = parseInt(value, 10);
  if (Number.isNaN(n)) return undefined;
  return n;
}

function clampInt(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function formatPrettyDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', year: 'numeric' };
  return new Intl.DateTimeFormat(undefined, opts).format(dt);
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

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F7F9' },
  container: { flex: 1, backgroundColor: '#F7F7F9' },
  header: {
    marginTop: 8,
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    ...platformShadow(),
  },
  statBox: { alignItems: 'center', flex: 1 },
  statDivider: { width: 1, height: 32, backgroundColor: '#EEE' },
  statNumber: { fontSize: 28, fontWeight: '800', color: '#111' },
  statLabel: { fontSize: 12, color: '#666', marginTop: 4, letterSpacing: 0.5 },
  calendarCard: {
    marginTop: 12,
    marginHorizontal: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 6,
    ...platformShadow(),
  },
  calendar: { borderRadius: 16 },

  listContent: { paddingHorizontal: 16, paddingBottom: 120 },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 12,
    ...platformShadow(),
  },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  cardTitle: { fontSize: 16, fontWeight: '700', color: '#111' },
  cardDate: { fontSize: 12, color: '#888' },
  cardMeta: { fontSize: 14, color: '#333' },
  cardNotes: { fontSize: 13, color: '#555', marginTop: 8 },
  deleteText: { color: '#EF4444', fontWeight: '700' },

  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#222' },
  emptySubtitle: { fontSize: 14, color: '#777', marginTop: 6 },
  emptyStateSmall: { paddingHorizontal: 16, paddingVertical: 24, alignItems: 'center' },

  section: { marginTop: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16 },
  sectionTitle: { fontSize: 16, fontWeight: '800', marginHorizontal: 16, marginBottom: 8, color: '#111' },
  chipsRow: { paddingHorizontal: 12, paddingBottom: 4 },
  chip: {
    backgroundColor: '#E5E7EB',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    marginHorizontal: 4,
  },
  chipText: { fontWeight: '700', color: '#111' },
  chipTextSelected: { color: '#FFF' },

  modalRoot: { flex: 1 },
  modalBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
    zIndex: 0,
  },
  modalContainer: { flex: 1, justifyContent: 'flex-end', zIndex: 1 },
  modalCard: {
    backgroundColor: '#FFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: '85%',
  },
  modalTitle: { fontSize: 18, fontWeight: '800', marginBottom: 8, color: '#111' },
  form: { paddingBottom: 12 },
  inputLabel: { fontSize: 12, color: '#666', marginTop: 12, marginBottom: 6 },
  input: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111',
  },
  notesInput: { minHeight: 72, textAlignVertical: 'top' },
  row: { flexDirection: 'row', alignItems: 'flex-start' },
  rowItem: { flex: 1 },
  rowSpacer: { width: 12 },
  modalActions: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 12 },
  button: { borderRadius: 999, paddingVertical: 12, paddingHorizontal: 18, marginLeft: 8 },
  primaryButton: { backgroundColor: '#111827' },
  secondaryButton: { backgroundColor: '#E5E7EB' },
  buttonText: { color: '#FFF', fontWeight: '700' },
  secondaryButtonText: { color: '#111827' },
  fab: {
    position: 'absolute',
    right: 24,
    bottom: 24,
    width: 56,
    height: 56,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
    ...platformShadow(6),
  },
});

function platformShadow(elevation: number = 3) {
  if (Platform.OS === 'ios') {
    return {
      shadowColor: '#000',
      shadowOpacity: 0.08,
      shadowOffset: { width: 0, height: 6 },
      shadowRadius: 12,
    };
  }
  return { elevation };
}

function buildMarkedDates(
  selected: string,
  exercisesByDate: Record<string, Exercise[]>,
  dayTypeByDate: Record<string, DayType>
) {
  const result: Record<string, any> = {};
  const dates = new Set<string>([
    ...Object.keys(exercisesByDate),
    ...Object.keys(dayTypeByDate),
  ]);
  for (const date of dates) {
    const dayType = dayTypeByDate[date];
    const hasExercises = (exercisesByDate[date]?.length || 0) > 0;
    const color = dayType ? DAY_TYPE_COLORS[dayType] : '#111827';
    if (hasExercises || dayType) {
      result[date] = {
        marked: true,
        dotColor: color,
      };
    }
  }
  // Add selected styling (merging with existing if present)
  const prev = result[selected] || {};
  result[selected] = {
    ...prev,
    selected: true,
    selectedColor: '#111827',
    selectedTextColor: '#FFFFFF',
  };
  return result;
}