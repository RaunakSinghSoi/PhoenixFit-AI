import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, Modal, TextInput, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Speech from 'expo-speech';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ExerciseType } from './ExerciseSelectionScreen';
import { useFocusEffect } from '@react-navigation/native';
import { FASTAPI_BASE_URL } from '../config/api';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { connectIMUWS, IMUSample, WsConn } from '../imuWs';
import { auth, firestore } from '../lib/firebase';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';

const TARGET_FRAME_MS = 120;
const STORAGE_SERVER_URL = '@pfa_fastapi_server_url_v1';
const STORAGE_IMU_URL = '@pfa_imu_ws_url_v1';
const DEFAULT_IMU_URL = 'ws://192.168.4.1:81';

type RouteParams = {
  exercise: ExerciseType;
};

type Props = NativeStackScreenProps<any, any> & {
  route: { params: RouteParams };
};

type AnalysisState = {
  reps: number;
  score: number | null;
  phase: string | null;
  coach: string | null;
  poseFound: boolean | null;
  fps?: number | null;
  angles?: Record<string, number | null> | null;
  debug?: { frame_w: number; frame_h: number } | null;
  landmarks?: Array<{ x: number; y: number; v?: number }> | null;
  bbox?: { xmin: number; ymin: number; xmax: number; ymax: number } | null;
  poseConfidence?: number | null;
  // Per-rep scoring
  rep_scores?: number[];
  rep_just_completed?: boolean;
  latest_rep_score?: number | null;
};

type IMUStats = {
  sampleCount: number;
  maxAccelMag: number;
  sumAccelMag: number;
  maxAccelX: number;
  maxAccelY: number;
  maxAccelZ: number;
  minAccelX: number;
  minAccelY: number;
  minAccelZ: number;
  // For movement analysis
  peakPower: number;  // Highest instantaneous acceleration
  avgPower: number;   // Average acceleration during movement
};

type WorkoutSummary = {
  exercise: ExerciseType;
  reps: number;
  avgScore: number | null;
  duration: number; // seconds
  imuConnected: boolean;
  imu: IMUStats | null;
  repScores: number[];  // Individual score for each rep
};

export default function RepTrackingScreen({ route, navigation }: Props) {
  const { exercise } = route.params;
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = React.useRef<CameraView | null>(null);

  const [running, setRunning] = React.useState(false);
  const runningRef = React.useRef(false);
  const runIdRef = React.useRef<string>('');
  const frameIdRef = React.useRef<number>(0);
  const lastAppliedFrameIdRef = React.useRef<number>(-1);
  const [sessionId, setSessionId] = React.useState<string | null>(null);
  const [statusMessage, setStatusMessage] = React.useState<string>('Idle');
  const [analysis, setAnalysis] = React.useState<AnalysisState>({
    reps: 0, score: null, phase: null, coach: null, poseFound: null,
    fps: null, angles: null, debug: null, landmarks: null, bbox: null, poseConfidence: null,
    rep_scores: [], rep_just_completed: false, latest_rep_score: null,
  });
  const [lastResultAt, setLastResultAt] = React.useState<number | null>(null);
  const [nowTick, setNowTick] = React.useState<number>(() => Date.now());
  const [serverUrl, setServerUrl] = React.useState<string>(FASTAPI_BASE_URL);
  const [serverModalVisible, setServerModalVisible] = React.useState(false);
  const [serverDraft, setServerDraft] = React.useState('');
  const [cameraFacing, setCameraFacing] = React.useState<'back' | 'front'>('back');
  const captureInFlightRef = React.useRef(false);
  const [viewSize, setViewSize] = React.useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // IMU state
  const [imuUrl, setImuUrl] = React.useState<string>(DEFAULT_IMU_URL);
  const [imuStatus, setImuStatus] = React.useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [imuModalVisible, setImuModalVisible] = React.useState(false);
  const [imuDraft, setImuDraft] = React.useState('');
  const imuConnRef = React.useRef<WsConn | null>(null);
  const [currentIMU, setCurrentIMU] = React.useState<IMUSample | null>(null);
  
  // IMU stats tracking during workout
  const imuStatsRef = React.useRef<IMUStats>({
    sampleCount: 0, maxAccelMag: 0, sumAccelMag: 0,
    maxAccelX: -Infinity, maxAccelY: -Infinity, maxAccelZ: -Infinity,
    minAccelX: Infinity, minAccelY: Infinity, minAccelZ: Infinity,
    peakPower: 0, avgPower: 0,
  });
  const scoreHistoryRef = React.useRef<number[]>([]);
  const workoutStartRef = React.useRef<number>(0);

  // Workout summary modal
  const [summaryModalVisible, setSummaryModalVisible] = React.useState(false);
  const [workoutSummary, setWorkoutSummary] = React.useState<WorkoutSummary | null>(null);

  // Voice feedback state
  const [voiceEnabled, setVoiceEnabled] = React.useState(true);
  const lastSpokenRepRef = React.useRef<number>(0);

  // Single voice cue per completed rep: "{rep}. {coach}"
  React.useEffect(() => {
    if (!voiceEnabled || !running) return;
    if (analysis.reps > lastSpokenRepRef.current && analysis.reps > 0) {
      lastSpokenRepRef.current = analysis.reps;
      const coach = analysis.coach?.trim();
      const msg = coach ? `${analysis.reps}. ${coach}` : `${analysis.reps}`;
      Speech.speak(msg, { rate: 1.0, pitch: 1.0 });
    }
  }, [analysis.reps, running, voiceEnabled]);

  // Load saved URLs
  React.useEffect(() => {
    (async () => {
      try {
        const savedServer = await AsyncStorage.getItem(STORAGE_SERVER_URL);
        if (savedServer?.trim()) setServerUrl(savedServer.trim());
        const savedIMU = await AsyncStorage.getItem(STORAGE_IMU_URL);
        if (savedIMU?.trim()) setImuUrl(savedIMU.trim());
      } catch {}
    })();
  }, []);

  React.useEffect(() => {
    if (!permission?.granted) void requestPermission();
  }, [permission, requestPermission]);

  useFocusEffect(
    React.useCallback(() => {
      return () => {
        stopWorkout(false);
        disconnectIMU();
      };
    }, [])
  );

  React.useEffect(() => {
    runningRef.current = running;
  }, [running]);

  React.useEffect(() => {
    stopWorkout(false);
  }, [exercise]);

  React.useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNowTick(Date.now()), 500);
    return () => clearInterval(t);
  }, [running]);

  // IMU connection
  function connectIMU() {
    if (imuConnRef.current) {
      imuConnRef.current.close();
      imuConnRef.current = null;
    }
    setImuStatus('connecting');
    imuConnRef.current = connectIMUWS(
      imuUrl,
      (sample) => {
        setCurrentIMU(sample);
        // Track stats if workout is running
        if (runningRef.current) {
          const stats = imuStatsRef.current;
          stats.sampleCount++;
          stats.sumAccelMag += sample.am;
          if (sample.am > stats.maxAccelMag) stats.maxAccelMag = sample.am;
          if (sample.am > stats.peakPower) stats.peakPower = sample.am;
          if (sample.ax > stats.maxAccelX) stats.maxAccelX = sample.ax;
          if (sample.ay > stats.maxAccelY) stats.maxAccelY = sample.ay;
          if (sample.az > stats.maxAccelZ) stats.maxAccelZ = sample.az;
          if (sample.ax < stats.minAccelX) stats.minAccelX = sample.ax;
          if (sample.ay < stats.minAccelY) stats.minAccelY = sample.ay;
          if (sample.az < stats.minAccelZ) stats.minAccelZ = sample.az;
        }
      },
      (status) => {
        if (status === 'connected') setImuStatus('connected');
        else if (status === 'error') setImuStatus('error');
        else if (status === 'closed') setImuStatus('disconnected');
      }
    );
  }

  function disconnectIMU() {
    if (imuConnRef.current) {
      imuConnRef.current.close();
      imuConnRef.current = null;
    }
    setImuStatus('disconnected');
    setCurrentIMU(null);
  }

  function openImuModal() {
    setImuDraft(imuUrl);
    setImuModalVisible(true);
  }

  async function saveImuModal() {
    let url = imuDraft.trim();
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = `ws://${url}`;
    }
    setImuUrl(url);
    try { await AsyncStorage.setItem(STORAGE_IMU_URL, url); } catch {}
    setImuModalVisible(false);
    // Auto-connect after saving
    setTimeout(() => {
      if (imuConnRef.current) imuConnRef.current.close();
      imuConnRef.current = null;
      setImuStatus('disconnected');
      connectIMU();
    }, 100);
  }

  function openServerModal() {
    setServerDraft(serverUrl);
    setServerModalVisible(true);
  }

  async function saveServerModal() {
    const normalized = normalizeServerUrl(serverDraft);
    if (!normalized) {
      Alert.alert('Invalid URL', 'Please enter a valid http:// or https:// address.');
      return;
    }
    setServerUrl(normalized);
    setStatusMessage(`Server set to ${normalized}`);
    try { await AsyncStorage.setItem(STORAGE_SERVER_URL, normalized); } catch {}
    setServerModalVisible(false);
  }

  function toggleCameraFacing() {
    setCameraFacing(prev => (prev === 'back' ? 'front' : 'back'));
  }

  function ensureSessionId() {
    if (!sessionId) {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
      setSessionId(id);
      return id;
    }
    return sessionId;
  }

  async function startWorkout() {
    if (runningRef.current) return;
    if (!permission?.granted) {
      const { status } = await requestPermission();
      if (status !== 'granted') {
        Alert.alert('Camera required', 'Please grant camera access to track reps.');
        return;
      }
    }
    if (!cameraRef.current) {
      Alert.alert('Camera not ready', 'Please wait for the camera to initialize.');
      return;
    }

    const runId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    runIdRef.current = runId;
    frameIdRef.current = 0;
    lastAppliedFrameIdRef.current = -1;

    // Reset voice feedback refs
    lastSpokenRepRef.current = 0;

    // Announce workout start
    if (voiceEnabled) {
      Speech.speak(`Starting ${exercise}`, { rate: 1.0, pitch: 1.0 });
    }

    // Reset stats
    imuStatsRef.current = {
      sampleCount: 0, maxAccelMag: 0, sumAccelMag: 0,
      maxAccelX: -Infinity, maxAccelY: -Infinity, maxAccelZ: -Infinity,
      minAccelX: Infinity, minAccelY: Infinity, minAccelZ: Infinity,
      peakPower: 0, avgPower: 0,
    };
    scoreHistoryRef.current = [];
    workoutStartRef.current = Date.now();

    setStatusMessage('Checking server…');
    const healthUrl = `${serverUrl}/health`;
    const analyzeUrl = `${serverUrl}/analyze-frame`;
    try {
      const health = await fetch(healthUrl);
      if (!health.ok) {
        setStatusMessage(`Server error: ${await health.text() || health.status}`);
        return;
      }
    } catch (e: any) {
      setStatusMessage(`Server unreachable: ${e?.message || 'network error'}`);
      return;
    }

    const id = ensureSessionId();
    setAnalysis({ reps: 0, score: null, phase: null, coach: null, poseFound: null, fps: null, angles: null, debug: null, landmarks: null, bbox: null, poseConfidence: null });
    setLastResultAt(null);
    setRunning(true);
    setStatusMessage('Starting camera…');

    await new Promise(r => setTimeout(r, 300));
    if (!runningRef.current || runIdRef.current !== runId) return;

    setStatusMessage('Streaming…');
    void pumpFrames(runId, id, analyzeUrl);
  }

  async function stopWorkout(showSummary = true) {
    // Stop any ongoing speech
    Speech.stop();

    if (!runningRef.current && !showSummary) {
      // Not running, just reset
      setRunning(false);
      runIdRef.current = '';
      return;
    }

    const wasRunning = runningRef.current;
    const finalReps = analysis.reps;
    const scores = scoreHistoryRef.current;
    const avgScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
    const duration = wasRunning ? (Date.now() - workoutStartRef.current) / 1000 : 0;
    const imuStats = imuStatsRef.current;
    
    // Calculate avg power
    if (imuStats.sampleCount > 0) {
      imuStats.avgPower = imuStats.sumAccelMag / imuStats.sampleCount;
    }

    setRunning(false);
    runningRef.current = false;
    runIdRef.current = '';

    // Get per-rep scores from analysis state
    const repScores = analysis.rep_scores || [];

    // Save workout to Firebase if user is logged in and workout was meaningful
    if (wasRunning && finalReps > 0) {
      const user = auth.currentUser;
      if (user) {
        try {
          const workoutData = {
            exercise,
            reps: finalReps,
            avgScore: avgScore,
            repScores: repScores,
            duration: Math.round(duration),
            completedAt: serverTimestamp(),
            // IMU data (if connected)
            imuConnected: imuStatus === 'connected',
            imu: imuStats.sampleCount > 0 ? {
              sampleCount: imuStats.sampleCount,
              peakPower: imuStats.peakPower,
              avgPower: imuStats.avgPower,
              maxAccelMag: imuStats.maxAccelMag,
              maxAccelX: Number.isFinite(imuStats.maxAccelX) ? imuStats.maxAccelX : null,
              maxAccelY: Number.isFinite(imuStats.maxAccelY) ? imuStats.maxAccelY : null,
              maxAccelZ: Number.isFinite(imuStats.maxAccelZ) ? imuStats.maxAccelZ : null,
              minAccelX: Number.isFinite(imuStats.minAccelX) ? imuStats.minAccelX : null,
              minAccelY: Number.isFinite(imuStats.minAccelY) ? imuStats.minAccelY : null,
              minAccelZ: Number.isFinite(imuStats.minAccelZ) ? imuStats.minAccelZ : null,
            } : null,
          };

          const colRef = collection(firestore, 'users', user.uid, 'workoutHistory');
          await addDoc(colRef, workoutData);
          console.log('[Firebase] Workout saved successfully');
        } catch (e) {
          console.error('[Firebase] Failed to save workout:', e);
        }
      }
    }

    // Announce completion
    if (voiceEnabled && wasRunning && finalReps > 0) {
      setTimeout(() => {
        Speech.speak(`Workout complete. ${finalReps} reps`, { rate: 1.0, pitch: 1.0 });
      }, 300);
    }

    if (showSummary && wasRunning && (finalReps > 0 || duration > 5)) {
      const summary: WorkoutSummary = {
        exercise,
        reps: finalReps,
        avgScore,
        duration,
        imuConnected: imuStatus === 'connected',
        imu: imuStats.sampleCount > 0 ? { ...imuStats } : null,
        repScores,
      };
      setWorkoutSummary(summary);
      setSummaryModalVisible(true);
    }

    setAnalysis({ reps: 0, score: null, phase: null, coach: null, poseFound: null, fps: null, angles: null, debug: null, landmarks: null, bbox: null, poseConfidence: null, rep_scores: [], rep_just_completed: false, latest_rep_score: null });
    setSessionId(null);
    setStatusMessage('Stopped');
  }

  async function pumpFrames(runId: string, activeSessionId: string, analyzeUrl: string) {
    while (runningRef.current && runIdRef.current === runId) {
      const t0 = Date.now();
      const fid = frameIdRef.current++;
      await captureAndSendFrame(runId, fid, activeSessionId, analyzeUrl);
      const elapsed = Date.now() - t0;
      const delay = Math.max(0, TARGET_FRAME_MS - elapsed);
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
    }
  }

  async function captureAndSendFrame(runId: string, frameId: number, activeSessionId: string, analyzeUrlOverride?: string) {
    if (!cameraRef.current) { setStatusMessage('Camera not ready…'); return; }
    if (captureInFlightRef.current) return;
    if (!runningRef.current || runIdRef.current !== runId) return;

    captureInFlightRef.current = true;
    const analyzeUrl = analyzeUrlOverride || `${serverUrl}/analyze-frame`;

    try {
      let photo: { uri: string; exif?: any } | undefined;
      try {
        photo = await cameraRef.current.takePictureAsync({ quality: 0.6, skipProcessing: false, exif: true });
      } catch (photoErr: any) {
        setStatusMessage(`Camera error: ${photoErr?.message || 'takePicture failed'}`);
        return;
      }

      if (!photo || !photo.uri) { setStatusMessage('Camera returned empty frame, retrying…'); return; }

      const exif: any = photo.exif;
      const orientation: number | undefined =
        typeof exif?.Orientation === 'number' ? exif.Orientation :
        typeof exif?.orientation === 'number' ? exif.orientation : undefined;
      let rotateDeg = 0;
      if (orientation === 3) rotateDeg = 180;
      else if (orientation === 6) rotateDeg = 90;
      else if (orientation === 8) rotateDeg = 270;

      const actions: ImageManipulator.Action[] = [];
      if (rotateDeg) actions.push({ rotate: rotateDeg });
      actions.push({ resize: { width: 480 } });

      let manipulated: { uri: string };
      try {
        manipulated = await ImageManipulator.manipulateAsync(photo.uri, actions, { compress: 0.6, format: ImageManipulator.SaveFormat.JPEG });
      } catch (manipErr: any) {
        setStatusMessage(`Image error: ${manipErr?.message || 'manipulation failed'}`);
        return;
      }

      const formData = new FormData();
      formData.append('file', { uri: manipulated.uri, name: 'frame.jpg', type: 'image/jpeg' } as any);
      formData.append('run_id', runId);
      formData.append('frame_id', String(frameId));
      formData.append('session_id', activeSessionId);
      formData.append('exercise', exercise);

      let response: Response;
      try {
        response = await fetch(analyzeUrl, { method: 'POST', headers: { Accept: 'application/json' }, body: formData });
      } catch (fetchErr: any) {
        setStatusMessage(`Network error: ${fetchErr?.message || 'fetch failed'}`);
        return;
      }

      if (!response.ok) { setStatusMessage(`API error: ${response.status} ${await response.text() || ''}`); return; }

      let json: any = {};
      try { json = await response.json(); } catch { setStatusMessage('API error: invalid JSON'); return; }

      if (!runningRef.current || runIdRef.current !== runId) return;
      if (frameId < lastAppliedFrameIdRef.current) return;
      lastAppliedFrameIdRef.current = frameId;

      // Track score history
      if (typeof json.score === 'number') scoreHistoryRef.current.push(json.score);

      setAnalysis(prev => ({
        reps: typeof json.reps === 'number' ? json.reps : prev.reps,
        score: typeof json.score === 'number' ? json.score : prev.score,
        phase: typeof json.phase === 'string' ? json.phase : prev.phase,
        coach: typeof json.coach === 'string' ? json.coach : prev.coach,
        poseFound: typeof json.poseFound === 'boolean' ? json.poseFound : prev.poseFound,
        fps: typeof json.fps === 'number' ? json.fps : prev.fps,
        angles: typeof json.angles === 'object' && json.angles ? json.angles : prev.angles,
        debug: typeof json._debug === 'object' && json._debug ? json._debug : prev.debug,
        landmarks: Array.isArray(json.landmarks) ? json.landmarks : prev.landmarks,
        bbox: typeof json.bbox === 'object' && json.bbox ? json.bbox : prev.bbox,
        poseConfidence: typeof json.poseConfidence === 'number' ? json.poseConfidence : prev.poseConfidence,
        // Per-rep scoring
        rep_scores: Array.isArray(json.rep_scores) ? json.rep_scores : prev.rep_scores,
        rep_just_completed: typeof json.rep_just_completed === 'boolean' ? json.rep_just_completed : false,
        latest_rep_score: typeof json.latest_rep_score === 'number' ? json.latest_rep_score : null,
      }));
      setLastResultAt(Date.now());
      setStatusMessage(`Streaming… (frame ${frameId})`);
    } catch (e: any) {
      setStatusMessage(`Capture error: ${e?.message || 'unknown'}`);
    } finally {
      captureInFlightRef.current = false;
    }
  }

  const msSinceLast = lastResultAt != null ? (nowTick - lastResultAt) : null;
  const secondsSinceLast = msSinceLast != null ? Math.max(0, msSinceLast / 1000) : null;
  const stale = secondsSinceLast != null ? secondsSinceLast > 2.5 : false;
  const poseOk = analysis.poseFound === true;
  const poseUnknown = analysis.poseFound == null;
  const hasLandmarks = Array.isArray(analysis.landmarks) && analysis.landmarks.length >= 10;

  const exerciseLabel = exercise === 'squat' ? 'Squat' : exercise === 'pushup' ? 'Push Up' : 'Deadlift';

  const imuConnected = imuStatus === 'connected';
  const imuColor = imuStatus === 'connected' ? '#10B981' : imuStatus === 'connecting' ? '#F59E0B' : '#6B7280';

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.container} onLayout={(e) => setViewSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <CameraView style={StyleSheet.absoluteFill} facing={cameraFacing} mode="picture" ref={ref => { cameraRef.current = ref; }} />

        {/* Top banner */}
        <View pointerEvents="none" style={styles.topOverlay}>
          <View style={[styles.poseBanner, poseOk ? styles.poseBannerOk : styles.poseBannerBad]}>
            <Text style={styles.poseBannerTitle}>
              {(poseOk && hasLandmarks) ? 'BODY DETECTED' : poseUnknown ? 'START TO DETECT BODY…' : 'NO BODY DETECTED'}
            </Text>
            <Text style={styles.poseBannerSub}>
              {!running ? 'Tap Start to begin.' : stale ? 'No new frames (check server).' : (poseOk && hasLandmarks) ? 'Good. Keep full body in frame.' : 'Step back, show full body.'}
            </Text>
          </View>
        </View>

        {/* Bottom overlay */}
        <View style={styles.overlay}>
          <View style={styles.headerRow}>
            <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
              <Text style={styles.backText}>← Back</Text>
            </TouchableOpacity>
            <Text style={styles.title}>{exerciseLabel}</Text>
            <View style={styles.headerIcons}>
              <TouchableOpacity onPress={() => setVoiceEnabled(!voiceEnabled)} style={styles.iconButton}>
                <Ionicons name={voiceEnabled ? "volume-high-outline" : "volume-mute-outline"} size={20} color={voiceEnabled ? "#10B981" : "#6B7280"} />
              </TouchableOpacity>
              <TouchableOpacity onPress={toggleCameraFacing} style={styles.iconButton}>
                <Ionicons name="camera-reverse-outline" size={20} color="#E5E7EB" />
              </TouchableOpacity>
              <TouchableOpacity onPress={openServerModal} style={styles.iconButton}>
                <Ionicons name="server-outline" size={20} color="#E5E7EB" />
              </TouchableOpacity>
            </View>
          </View>

          {/* IMU Connection Row */}
          <View style={styles.imuRow}>
            <TouchableOpacity 
              onPress={imuConnected ? disconnectIMU : connectIMU} 
              style={[styles.imuButton, { borderColor: imuColor }]}
            >
              <Ionicons name="hardware-chip-outline" size={16} color={imuColor} />
              <Text style={[styles.imuButtonText, { color: imuColor }]}>
                {imuStatus === 'connected' ? 'IMU Connected' : imuStatus === 'connecting' ? 'Connecting…' : 'Connect IMU'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openImuModal} style={styles.imuSettingsBtn}>
              <Ionicons name="settings-outline" size={16} color="#9CA3AF" />
            </TouchableOpacity>
            {currentIMU && imuConnected && (
              <Text style={styles.imuLive}>
                Accel: {currentIMU.am.toFixed(1)} m/s²
              </Text>
            )}
          </View>

          {/* Stats */}
          <View style={styles.statsRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Reps</Text>
              <Text style={styles.statValue}>{analysis.reps}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Score</Text>
              <Text style={styles.statValue}>{analysis.score != null ? analysis.score.toFixed(0) : '--'}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Phase</Text>
              <Text style={styles.statValueSmall}>{analysis.phase || '--'}</Text>
            </View>
          </View>

          {/* Coach feedback */}
          <View style={styles.coachBox}>
            <Text style={styles.coachLabel}>Form Feedback</Text>
            <Text style={styles.coachText}>
              {analysis.poseFound === false ? 'Position your full body in frame.' : (analysis.coach || 'Good form!')}
            </Text>
          </View>

          {/* Buttons */}
          <View style={styles.buttonsRow}>
            <TouchableOpacity onPress={startWorkout} disabled={running} style={[styles.button, running ? styles.buttonDisabled : styles.buttonPrimary]}>
              <Ionicons name="play" size={18} color="#FFF" />
              <Text style={styles.buttonText}> Start</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => stopWorkout(true)} disabled={!running} style={[styles.button, !running ? styles.buttonDisabled : styles.buttonSecondary]}>
              <Ionicons name="stop" size={18} color="#FFF" />
              <Text style={styles.buttonText}> Stop</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.statusText}>{statusMessage}</Text>
        </View>
      </View>

      {/* Server URL Modal */}
      <Modal visible={serverModalVisible} transparent animationType="slide" onRequestClose={() => setServerModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Vision Server URL</Text>
            <TextInput value={serverDraft} onChangeText={setServerDraft} placeholder="http://192.168.1.100:8000" autoCapitalize="none" style={styles.modalInput} placeholderTextColor="#6B7280" />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setServerModalVisible(false)} style={[styles.modalBtn, styles.modalBtnCancel]}><Text style={styles.modalBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveServerModal} style={[styles.modalBtn, styles.modalBtnSave]}><Text style={styles.modalBtnText}>Save</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* IMU URL Modal */}
      <Modal visible={imuModalVisible} transparent animationType="slide" onRequestClose={() => setImuModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>IMU WebSocket URL</Text>
            <Text style={styles.modalHint}>Connect to PhoenixIMU-AP Wi-Fi first, then use:</Text>
            <TextInput value={imuDraft} onChangeText={setImuDraft} placeholder="ws://192.168.4.1:81" autoCapitalize="none" style={styles.modalInput} placeholderTextColor="#6B7280" />
            <View style={styles.modalActions}>
              <TouchableOpacity onPress={() => setImuModalVisible(false)} style={[styles.modalBtn, styles.modalBtnCancel]}><Text style={styles.modalBtnText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveImuModal} style={[styles.modalBtn, styles.modalBtnSave]}><Text style={styles.modalBtnText}>Save & Connect</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Workout Summary Modal */}
      <Modal visible={summaryModalVisible} transparent animationType="fade" onRequestClose={() => setSummaryModalVisible(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryTitle}>Workout Complete!</Text>
            <Text style={styles.summaryExercise}>{workoutSummary?.exercise.toUpperCase()}</Text>
            
            <View style={styles.summaryGrid}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryItemValue}>{workoutSummary?.reps || 0}</Text>
                <Text style={styles.summaryItemLabel}>Reps</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryItemValue}>{workoutSummary?.avgScore?.toFixed(0) || '--'}</Text>
                <Text style={styles.summaryItemLabel}>Avg Score</Text>
              </View>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryItemValue}>{formatDuration(workoutSummary?.duration || 0)}</Text>
                <Text style={styles.summaryItemLabel}>Duration</Text>
              </View>
            </View>

            {/* Per-Rep Scores */}
            {workoutSummary?.repScores && workoutSummary.repScores.length > 0 && (
              <View style={styles.repScoresSection}>
                <Text style={styles.repScoresTitle}>Rep Scores</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.repScoresScroll}>
                  {workoutSummary.repScores.map((score, index) => (
                    <View key={index} style={styles.repScoreItem}>
                      <Text style={styles.repScoreNumber}>#{index + 1}</Text>
                      <Text style={[
                        styles.repScoreValue,
                        score >= 80 ? styles.scoreGood : score >= 60 ? styles.scoreOk : styles.scoreBad
                      ]}>{score}</Text>
                    </View>
                  ))}
                </ScrollView>
              </View>
            )}

            {workoutSummary?.imu && (
              <View style={styles.imuSummarySection}>
                <Text style={styles.imuSummaryTitle}>IMU Metrics</Text>
                <View style={styles.imuSummaryGrid}>
                  <View style={styles.imuSummaryItem}>
                    <Text style={styles.imuSummaryValue}>{workoutSummary.imu.peakPower.toFixed(1)}</Text>
                    <Text style={styles.imuSummaryLabel}>Peak Accel (m/s²)</Text>
                  </View>
                  <View style={styles.imuSummaryItem}>
                    <Text style={styles.imuSummaryValue}>{workoutSummary.imu.avgPower.toFixed(1)}</Text>
                    <Text style={styles.imuSummaryLabel}>Avg Accel (m/s²)</Text>
                  </View>
                  <View style={styles.imuSummaryItem}>
                    <Text style={styles.imuSummaryValue}>{workoutSummary.imu.sampleCount}</Text>
                    <Text style={styles.imuSummaryLabel}>IMU Samples</Text>
                  </View>
                </View>
                <Text style={styles.imuSummaryHint}>
                  {getIMUFeedback(workoutSummary.exercise, workoutSummary.imu)}
                </Text>
              </View>
            )}

            {!workoutSummary?.imu && (
              <View style={styles.noImuBox}>
                <Text style={styles.noImuText}>Connect IMU for movement metrics</Text>
              </View>
            )}

            <TouchableOpacity onPress={() => setSummaryModalVisible(false)} style={styles.summaryCloseBtn}>
              <Text style={styles.summaryCloseBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function normalizeServerUrl(input: string): string | null {
  if (!input) return null;
  let trimmed = input.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed)) trimmed = `http://${trimmed}`;
  trimmed = trimmed.replace(/\/+$/, '');
  try {
    const parsed = new URL(trimmed);
    return `${parsed.protocol}//${parsed.hostname}:${parsed.port || '8000'}`;
  } catch { return null; }
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
}

function getIMUFeedback(exercise: ExerciseType, imu: IMUStats): string {
  const peak = imu.peakPower;
  
  if (exercise === 'squat') {
    if (peak > 15) return 'Explosive power! Great speed on the way up.';
    if (peak > 8) return 'Good controlled movement with solid acceleration.';
    return 'Try to be more explosive coming out of the bottom.';
  }
  if (exercise === 'pushup') {
    if (peak > 12) return 'Powerful push! Great explosive strength.';
    if (peak > 6) return 'Controlled push-ups with good tempo.';
    return 'Try pushing up faster for more power development.';
  }
  if (exercise === 'deadlift') {
    if (peak > 10) return 'Strong hip drive! Great pulling power.';
    if (peak > 5) return 'Controlled lift with steady acceleration.';
    return 'Focus on driving through your heels explosively.';
  }
  return '';
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#000' },
  container: { flex: 1 },
  topOverlay: { position: 'absolute', left: 0, right: 0, top: 0, paddingHorizontal: 12, paddingTop: 8, zIndex: 5 },
  poseBanner: { borderRadius: 12, paddingVertical: 8, paddingHorizontal: 12, borderWidth: 2 },
  poseBannerOk: { backgroundColor: 'rgba(16,185,129,0.25)', borderColor: '#10B981' },
  poseBannerBad: { backgroundColor: 'rgba(239,68,68,0.25)', borderColor: '#EF4444' },
  poseBannerTitle: { color: '#FFF', fontWeight: '800', fontSize: 14 },
  poseBannerSub: { color: '#D1D5DB', fontSize: 11, marginTop: 2 },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16, backgroundColor: 'rgba(0,0,0,0.75)', borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  backButton: { paddingVertical: 4 },
  backText: { color: '#E5E7EB', fontSize: 14, fontWeight: '600' },
  title: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  headerIcons: { flexDirection: 'row' },
  iconButton: { paddingHorizontal: 8, paddingVertical: 4 },
  imuRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 8 },
  imuButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20, borderWidth: 1.5, gap: 6 },
  imuButtonText: { fontSize: 12, fontWeight: '600' },
  imuSettingsBtn: { padding: 6 },
  imuLive: { color: '#10B981', fontSize: 12, fontWeight: '600', marginLeft: 'auto' },
  statsRow: { flexDirection: 'row', marginBottom: 12 },
  statBox: { flex: 1 },
  statLabel: { color: '#9CA3AF', fontSize: 11, fontWeight: '600' },
  statValue: { color: '#FFF', fontSize: 32, fontWeight: '800' },
  statValueSmall: { color: '#FFF', fontSize: 16, fontWeight: '600', marginTop: 8 },
  coachBox: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 12, marginBottom: 12 },
  coachLabel: { color: '#9CA3AF', fontSize: 10, fontWeight: '700', marginBottom: 4 },
  coachText: { color: '#FFF', fontSize: 14, fontWeight: '500' },
  buttonsRow: { flexDirection: 'row', gap: 12 },
  button: { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', borderRadius: 12, paddingVertical: 14 },
  buttonPrimary: { backgroundColor: '#10B981' },
  buttonSecondary: { backgroundColor: '#EF4444' },
  buttonDisabled: { backgroundColor: '#374151' },
  buttonText: { color: '#FFF', fontWeight: '700', fontSize: 16 },
  statusText: { color: '#6B7280', fontSize: 11, textAlign: 'center', marginTop: 8 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 },
  modalCard: { backgroundColor: '#1F2937', borderRadius: 16, padding: 20 },
  modalTitle: { color: '#FFF', fontSize: 18, fontWeight: '800', marginBottom: 12 },
  modalHint: { color: '#9CA3AF', fontSize: 12, marginBottom: 8 },
  modalInput: { backgroundColor: '#374151', borderRadius: 10, padding: 12, color: '#FFF', fontSize: 14, marginBottom: 16 },
  modalActions: { flexDirection: 'row', gap: 12 },
  modalBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  modalBtnCancel: { backgroundColor: '#374151' },
  modalBtnSave: { backgroundColor: '#10B981' },
  modalBtnText: { color: '#FFF', fontWeight: '700' },
  summaryCard: { backgroundColor: '#1F2937', borderRadius: 20, padding: 24, alignItems: 'center' },
  summaryTitle: { color: '#FFF', fontSize: 24, fontWeight: '800', marginBottom: 4 },
  summaryExercise: { color: '#10B981', fontSize: 16, fontWeight: '700', marginBottom: 20 },
  summaryGrid: { flexDirection: 'row', width: '100%', marginBottom: 20 },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryItemValue: { color: '#FFF', fontSize: 36, fontWeight: '800' },
  summaryItemLabel: { color: '#9CA3AF', fontSize: 12, marginTop: 4 },
  imuSummarySection: { width: '100%', backgroundColor: 'rgba(16,185,129,0.15)', borderRadius: 12, padding: 16, marginBottom: 16 },
  imuSummaryTitle: { color: '#10B981', fontSize: 14, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  imuSummaryGrid: { flexDirection: 'row', marginBottom: 12 },
  imuSummaryItem: { flex: 1, alignItems: 'center' },
  imuSummaryValue: { color: '#FFF', fontSize: 20, fontWeight: '800' },
  imuSummaryLabel: { color: '#9CA3AF', fontSize: 10, marginTop: 2, textAlign: 'center' },
  imuSummaryHint: { color: '#D1D5DB', fontSize: 12, textAlign: 'center', fontStyle: 'italic' },
  noImuBox: { backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 12, padding: 16, marginBottom: 16, width: '100%' },
  noImuText: { color: '#9CA3AF', fontSize: 13, textAlign: 'center' },
  summaryCloseBtn: { backgroundColor: '#10B981', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 48 },
  summaryCloseBtnText: { color: '#FFF', fontSize: 16, fontWeight: '700' },
  // Per-rep scores styles
  repScoresSection: { width: '100%', backgroundColor: 'rgba(59,130,246,0.15)', borderRadius: 12, padding: 16, marginBottom: 16 },
  repScoresTitle: { color: '#3B82F6', fontSize: 14, fontWeight: '700', marginBottom: 12, textAlign: 'center' },
  repScoresScroll: { flexDirection: 'row' },
  repScoreItem: { alignItems: 'center', marginRight: 16, minWidth: 50 },
  repScoreNumber: { color: '#9CA3AF', fontSize: 11, fontWeight: '600', marginBottom: 4 },
  repScoreValue: { fontSize: 24, fontWeight: '800' },
  scoreGood: { color: '#10B981' },
  scoreOk: { color: '#F59E0B' },
  scoreBad: { color: '#EF4444' },
});
