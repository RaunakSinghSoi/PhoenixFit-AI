import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, Modal, RefreshControl, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { auth, firestore } from '../lib/firebase';
import { collection, query, orderBy, limit, getDocs, Timestamp } from 'firebase/firestore';
import Ionicons from '@expo/vector-icons/Ionicons';

export type ExerciseType = 'squat' | 'pushup' | 'deadlift';

type WorkoutHistoryItem = {
  id: string;
  exercise: ExerciseType;
  reps: number;
  avgScore: number | null;
  repScores: number[];
  duration: number;
  completedAt: Date;
  imuConnected: boolean;
};

type Props = NativeStackScreenProps<any>;

export default function ExerciseSelectionScreen({ navigation }: Props) {
  const [workoutHistory, setWorkoutHistory] = React.useState<WorkoutHistoryItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [refreshing, setRefreshing] = React.useState(false);
  const [selectedWorkout, setSelectedWorkout] = React.useState<WorkoutHistoryItem | null>(null);
  const [detailModalVisible, setDetailModalVisible] = React.useState(false);

  // Fetch workout history when screen comes into focus
  useFocusEffect(
    React.useCallback(() => {
      fetchWorkoutHistory();
    }, [])
  );

  async function fetchWorkoutHistory() {
    const user = auth.currentUser;
    if (!user) {
      setWorkoutHistory([]);
      return;
    }

    setLoading(true);
    try {
      const colRef = collection(firestore, 'users', user.uid, 'workoutHistory');
      const q = query(colRef, orderBy('completedAt', 'desc'), limit(20));
      const snapshot = await getDocs(q);
      
      const items: WorkoutHistoryItem[] = [];
      snapshot.forEach((doc) => {
        const data = doc.data();
        const completedAt = data.completedAt instanceof Timestamp 
          ? data.completedAt.toDate() 
          : new Date(data.completedAt);
        
        items.push({
          id: doc.id,
          exercise: data.exercise || 'squat',
          reps: data.reps || 0,
          avgScore: data.avgScore ?? null,
          repScores: Array.isArray(data.repScores) ? data.repScores : [],
          duration: data.duration || 0,
          completedAt,
          imuConnected: data.imuConnected || false,
        });
      });
      
      setWorkoutHistory(items);
    } catch (e) {
      console.error('Failed to fetch workout history:', e);
    } finally {
      setLoading(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    await fetchWorkoutHistory();
    setRefreshing(false);
  }

  function go(exercise: ExerciseType) {
    navigation.navigate('RepTracking', { exercise });
  }

  function openWorkoutDetail(workout: WorkoutHistoryItem) {
    setSelectedWorkout(workout);
    setDetailModalVisible(true);
  }

  function formatDate(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
  }

  function getExerciseIcon(exercise: ExerciseType): string {
    switch (exercise) {
      case 'squat': return 'body-outline';
      case 'pushup': return 'fitness-outline';
      case 'deadlift': return 'barbell-outline';
      default: return 'barbell-outline';
    }
  }

  function getScoreColor(score: number): string {
    if (score >= 80) return '#10B981';
    if (score >= 60) return '#F59E0B';
    return '#EF4444';
  }

  const chartWorkouts = React.useMemo(() => {
    return workoutHistory.slice(0, 7).reverse();
  }, [workoutHistory]);

  const maxChartReps = React.useMemo(() => {
    let max = 1;
    for (const w of chartWorkouts) {
      if (w.reps > max) max = w.reps;
    }
    return max;
  }, [chartWorkouts]);

  const maxChartScore = React.useMemo(() => {
    let max = 100;
    for (const w of chartWorkouts) {
      if (typeof w.avgScore === 'number' && Number.isFinite(w.avgScore) && w.avgScore > max) max = w.avgScore;
    }
    return max;
  }, [chartWorkouts]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView 
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#111827" />
        }
      >
        <View style={styles.container}>
          <Text style={styles.title}>Start Workout</Text>
          <Text style={styles.subtitle}>Vision-based rep tracking with form feedback.</Text>

          <View style={styles.exerciseGrid}>
            <TouchableOpacity style={styles.exerciseCard} onPress={() => go('squat')}>
              <View style={[styles.exerciseIconBg, { backgroundColor: '#DCFCE7' }]}>
                <Ionicons name="body-outline" size={28} color="#10B981" />
              </View>
              <Text style={styles.exerciseTitle}>Squat</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.exerciseCard} onPress={() => go('pushup')}>
              <View style={[styles.exerciseIconBg, { backgroundColor: '#FEF3C7' }]}>
                <Ionicons name="fitness-outline" size={28} color="#F59E0B" />
              </View>
              <Text style={styles.exerciseTitle}>Push Up</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.exerciseCard} onPress={() => go('deadlift')}>
              <View style={[styles.exerciseIconBg, { backgroundColor: '#DBEAFE' }]}>
                <Ionicons name="barbell-outline" size={28} color="#3B82F6" />
              </View>
              <Text style={styles.exerciseTitle}>Deadlift</Text>
            </TouchableOpacity>
          </View>

          {/* Workout History Section */}
          <View style={styles.historySection}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>Recent Workouts</Text>
              {loading && <ActivityIndicator size="small" color="#6B7280" />}
            </View>

            {!auth.currentUser ? (
              <View style={styles.emptyState}>
                <Ionicons name="log-in-outline" size={32} color="#9CA3AF" />
                <Text style={styles.emptyText}>Sign in to see workout history</Text>
              </View>
            ) : workoutHistory.length === 0 && !loading ? (
              <View style={styles.emptyState}>
                <Ionicons name="barbell-outline" size={32} color="#9CA3AF" />
                <Text style={styles.emptyText}>No workouts yet</Text>
                <Text style={styles.emptySubtext}>Complete a workout to see it here</Text>
              </View>
            ) : (
              <>
                {chartWorkouts.length > 0 && (
                  <View style={styles.chartsWrap}>
                    <View style={styles.chartCard}>
                      <Text style={styles.chartTitle}>Reps Trend (last 7)</Text>
                      <View style={styles.barsRow}>
                        {chartWorkouts.map((w) => {
                          const h = Math.max(12, Math.round((w.reps / maxChartReps) * 90));
                          return (
                            <View key={`reps_${w.id}`} style={styles.barItem}>
                              <Text style={styles.barValue}>{w.reps}</Text>
                              <View style={[styles.bar, styles.barReps, { height: h }]} />
                              <Text style={styles.barLabel}>{w.completedAt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>

                    <View style={styles.chartCard}>
                      <Text style={styles.chartTitle}>Score Trend (last 7)</Text>
                      <View style={styles.barsRow}>
                        {chartWorkouts.map((w) => {
                          const score = typeof w.avgScore === 'number' && Number.isFinite(w.avgScore) ? w.avgScore : 0;
                          const h = score <= 0 ? 12 : Math.max(12, Math.round((score / maxChartScore) * 90));
                          const color = score > 0 ? getScoreColor(score) : '#D1D5DB';
                          return (
                            <View key={`score_${w.id}`} style={styles.barItem}>
                              <Text style={styles.barValue}>{score > 0 ? score.toFixed(0) : '--'}</Text>
                              <View style={[styles.bar, { height: h, backgroundColor: color }]} />
                              <Text style={styles.barLabel}>{w.completedAt.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })}</Text>
                            </View>
                          );
                        })}
                      </View>
                    </View>
                  </View>
                )}

                {workoutHistory.map((workout) => (
                  <TouchableOpacity
                    key={workout.id}
                    style={styles.historyCard}
                    onPress={() => openWorkoutDetail(workout)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.historyCardLeft}>
                      <View style={[styles.historyIconBg, {
                        backgroundColor: workout.exercise === 'squat' ? '#DCFCE7' :
                          workout.exercise === 'pushup' ? '#FEF3C7' : '#DBEAFE'
                      }]}>
                        <Ionicons
                          name={getExerciseIcon(workout.exercise) as any}
                          size={20}
                          color={workout.exercise === 'squat' ? '#10B981' :
                            workout.exercise === 'pushup' ? '#F59E0B' : '#3B82F6'}
                        />
                      </View>
                      <View style={styles.historyInfo}>
                        <Text style={styles.historyExercise}>
                          {workout.exercise.charAt(0).toUpperCase() + workout.exercise.slice(1)}
                        </Text>
                        <Text style={styles.historyMeta}>
                          {workout.reps} reps • {formatDuration(workout.duration)} • {formatDate(workout.completedAt)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.historyCardRight}>
                      {workout.avgScore != null && (
                        <View style={[styles.scoreBadge, { backgroundColor: getScoreColor(workout.avgScore) + '20' }]}>
                          <Text style={[styles.scoreText, { color: getScoreColor(workout.avgScore) }]}>
                            {workout.avgScore.toFixed(0)}
                          </Text>
                        </View>
                      )}
                      <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                    </View>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </View>
        </View>
      </ScrollView>

      {/* Workout Detail Modal */}
      <Modal 
        visible={detailModalVisible} 
        animationType="slide" 
        transparent 
        onRequestClose={() => setDetailModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {selectedWorkout && (
              <>
                <View style={styles.modalHeader}>
                  <View style={[styles.modalIconBg, { 
                    backgroundColor: selectedWorkout.exercise === 'squat' ? '#DCFCE7' : 
                      selectedWorkout.exercise === 'pushup' ? '#FEF3C7' : '#DBEAFE' 
                  }]}>
                    <Ionicons 
                      name={getExerciseIcon(selectedWorkout.exercise) as any} 
                      size={32} 
                      color={selectedWorkout.exercise === 'squat' ? '#10B981' : 
                        selectedWorkout.exercise === 'pushup' ? '#F59E0B' : '#3B82F6'} 
                    />
                  </View>
                  <Text style={styles.modalTitle}>
                    {selectedWorkout.exercise.charAt(0).toUpperCase() + selectedWorkout.exercise.slice(1)}
                  </Text>
                  <Text style={styles.modalDate}>
                    {selectedWorkout.completedAt.toLocaleDateString(undefined, { 
                      weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' 
                    })}
                  </Text>
                </View>

                <View style={styles.modalStats}>
                  <View style={styles.modalStatItem}>
                    <Text style={styles.modalStatValue}>{selectedWorkout.reps}</Text>
                    <Text style={styles.modalStatLabel}>Reps</Text>
                  </View>
                  <View style={styles.modalStatDivider} />
                  <View style={styles.modalStatItem}>
                    <Text style={styles.modalStatValue}>
                      {selectedWorkout.avgScore != null ? selectedWorkout.avgScore.toFixed(0) : '--'}
                    </Text>
                    <Text style={styles.modalStatLabel}>Avg Score</Text>
                  </View>
                  <View style={styles.modalStatDivider} />
                  <View style={styles.modalStatItem}>
                    <Text style={styles.modalStatValue}>{formatDuration(selectedWorkout.duration)}</Text>
                    <Text style={styles.modalStatLabel}>Duration</Text>
                  </View>
                </View>

                {/* Rep Scores Breakdown */}
                {selectedWorkout.repScores.length > 0 && (
                  <View style={styles.repScoresSection}>
                    <Text style={styles.repScoresSectionTitle}>Rep-by-Rep Scores</Text>
                    <ScrollView 
                      horizontal 
                      showsHorizontalScrollIndicator={false} 
                      style={styles.repScoresScroll}
                      contentContainerStyle={styles.repScoresContent}
                    >
                      {selectedWorkout.repScores.map((score, index) => (
                        <View key={index} style={styles.repScoreItem}>
                          <View style={[styles.repScoreCircle, { 
                            backgroundColor: getScoreColor(score) + '20',
                            borderColor: getScoreColor(score)
                          }]}>
                            <Text style={[styles.repScoreValue, { color: getScoreColor(score) }]}>
                              {score}
                            </Text>
                          </View>
                          <Text style={styles.repScoreLabel}>Rep {index + 1}</Text>
                        </View>
                      ))}
                    </ScrollView>
                    
                    {/* Score Legend */}
                    <View style={styles.scoreLegend}>
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: '#10B981' }]} />
                        <Text style={styles.legendText}>80+ Great</Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: '#F59E0B' }]} />
                        <Text style={styles.legendText}>60-79 Good</Text>
                      </View>
                      <View style={styles.legendItem}>
                        <View style={[styles.legendDot, { backgroundColor: '#EF4444' }]} />
                        <Text style={styles.legendText}>&lt;60 Needs Work</Text>
                      </View>
                    </View>
                  </View>
                )}

                {selectedWorkout.repScores.length === 0 && (
                  <View style={styles.noScoresBox}>
                    <Ionicons name="analytics-outline" size={24} color="#9CA3AF" />
                    <Text style={styles.noScoresText}>No rep scores recorded for this workout</Text>
                  </View>
                )}

                {selectedWorkout.imuConnected && (
                  <View style={styles.imuBadge}>
                    <Ionicons name="hardware-chip-outline" size={14} color="#10B981" />
                    <Text style={styles.imuBadgeText}>IMU Connected</Text>
                  </View>
                )}

                <TouchableOpacity 
                  style={styles.closeButton} 
                  onPress={() => setDetailModalVisible(false)}
                >
                  <Text style={styles.closeButtonText}>Close</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F7F7F9' },
  scrollView: { flex: 1 },
  scrollContent: { paddingBottom: 32 },
  container: { flex: 1, padding: 16 },
  title: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#6B7280', marginBottom: 20 },
  
  // Exercise Grid
  exerciseGrid: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 28,
  },
  exerciseCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 2,
  },
  exerciseIconBg: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  exerciseTitle: { fontSize: 14, fontWeight: '700', color: '#111827' },

  // History Section
  historySection: { marginTop: 4 },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  historyTitle: { fontSize: 18, fontWeight: '800', color: '#111827' },
  chartsWrap: { marginBottom: 12 },
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 12,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  chartTitle: { fontSize: 13, fontWeight: '700', color: '#374151', marginBottom: 8 },
  barsRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' },
  barItem: { flex: 1, alignItems: 'center' },
  bar: { width: 18, borderTopLeftRadius: 8, borderTopRightRadius: 8, backgroundColor: '#9CA3AF' },
  barReps: { backgroundColor: '#3B82F6' },
  barValue: { fontSize: 10, color: '#6B7280', marginBottom: 4, fontWeight: '600' },
  barLabel: { fontSize: 10, color: '#9CA3AF', marginTop: 6 },
  
  emptyState: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  emptyText: { fontSize: 15, fontWeight: '600', color: '#6B7280', marginTop: 12 },
  emptySubtext: { fontSize: 13, color: '#9CA3AF', marginTop: 4 },

  historyCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 1,
  },
  historyCardLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  historyIconBg: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  historyInfo: { flex: 1 },
  historyExercise: { fontSize: 15, fontWeight: '700', color: '#111827', marginBottom: 2 },
  historyMeta: { fontSize: 12, color: '#6B7280' },
  historyCardRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scoreBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
  },
  scoreText: { fontSize: 14, fontWeight: '800' },

  // Modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 36,
  },
  modalHeader: { alignItems: 'center', marginBottom: 20 },
  modalIconBg: {
    width: 64,
    height: 64,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  modalTitle: { fontSize: 22, fontWeight: '800', color: '#111827', marginBottom: 4 },
  modalDate: { fontSize: 13, color: '#6B7280' },

  modalStats: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
  },
  modalStatItem: { flex: 1, alignItems: 'center' },
  modalStatValue: { fontSize: 24, fontWeight: '800', color: '#111827', marginBottom: 2 },
  modalStatLabel: { fontSize: 12, color: '#6B7280' },
  modalStatDivider: { width: 1, backgroundColor: '#E5E7EB', marginHorizontal: 8 },

  // Rep Scores
  repScoresSection: {
    backgroundColor: '#F8FAFC',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
  },
  repScoresSectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#374151',
    marginBottom: 14,
    textAlign: 'center',
  },
  repScoresScroll: { marginBottom: 14 },
  repScoresContent: { paddingHorizontal: 4 },
  repScoreItem: { alignItems: 'center', marginRight: 14 },
  repScoreCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    marginBottom: 6,
  },
  repScoreValue: { fontSize: 16, fontWeight: '800' },
  repScoreLabel: { fontSize: 11, color: '#6B7280', fontWeight: '600' },

  scoreLegend: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E5E7EB',
  },
  legendItem: { flexDirection: 'row', alignItems: 'center' },
  legendDot: { width: 8, height: 8, borderRadius: 4, marginRight: 4 },
  legendText: { fontSize: 11, color: '#6B7280' },

  noScoresBox: {
    backgroundColor: '#F3F4F6',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  noScoresText: { fontSize: 13, color: '#6B7280', marginTop: 8, textAlign: 'center' },

  imuBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#DCFCE7',
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 12,
    alignSelf: 'center',
    marginBottom: 16,
    gap: 6,
  },
  imuBadgeText: { fontSize: 12, fontWeight: '600', color: '#10B981' },

  closeButton: {
    backgroundColor: '#111827',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  closeButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});


