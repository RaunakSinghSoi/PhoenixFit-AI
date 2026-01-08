import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, PermissionsAndroid, StyleProp, ViewStyle, TextInput, ScrollView, Alert } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import Constants from 'expo-constants';
import { connectIMUWS, IMUSample as IMUSampleWS, WsConn } from '../imuWs';
import { auth, firestore } from '../lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

type Status = 'Idle' | 'Scanning' | 'Connecting' | 'Connected';
type WorkoutKind = 'Squat' | 'Push Up' | 'Deadlift';

export default function WorkoutScreen() {
  const [camPermission, requestCam] = useCameraPermissions();
  const [status, setStatus] = React.useState<Status>('Idle');
  const [sample, setSample] = React.useState<IMUSampleWS>({ y: 0, p: 0, r: 0, ax: 0, ay: 0, az: 0, am: 0 });
  const [selectedWorkout, setSelectedWorkout] = React.useState<WorkoutKind>('Squat');
  const bleConnRef = React.useRef<any | undefined>(undefined);
  const isExpoGo = (Constants as any)?.appOwnership === 'expo';
  const [demoMode, setDemoMode] = React.useState<boolean>(isExpoGo);
  const [transport, setTransport] = React.useState<'demo' | 'wifi' | 'ble'>(isExpoGo ? 'demo' : 'wifi');
  const [wsUrl, setWsUrl] = React.useState<string>('ws://192.168.4.1:81');
  const wsRef = React.useRef<WsConn | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [maxAccel, setMaxAccel] = React.useState(0);

  React.useEffect(() => {
    void requestAllPermissions();
    return () => {
      try { wsRef.current?.close(); } catch {}
      (async () => {
        try {
          if (bleConnRef.current) {
            const { disconnectSafe, stopScan } = await import('../ble');
            stopScan();
            await disconnectSafe(bleConnRef.current);
          }
        } catch {}
      })();
    };
  }, []);

  function handleSample(s: IMUSampleWS) {
    setSample(s);
    if (recording) {
      setMaxAccel(prev => Math.max(prev, s.am));
    }
  }

  // Demo generator
  React.useEffect(() => {
    let timer: any;
    if (demoMode) {
      setStatus('Connected');
      let t = 0;
      timer = setInterval(() => {
        t += 0.1;
        const y = Math.sin(t) * 45;
        const p = Math.cos(t * 0.8) * 30;
        const r = Math.sin(t * 0.6) * 15;
        const ax = Math.sin(t) * 1.2;
        const ay = Math.cos(t * 1.1) * 1.2;
        const az = 9.81 + Math.sin(t * 0.3) * 0.2;
        const am = Math.sqrt(ax * ax + ay * ay + az * az);
        handleSample({ y, p, r, ax, ay, az, am });
      }, 100);
    } else {
      setStatus('Idle');
    }
    return () => { if (timer) clearInterval(timer); };
  }, [demoMode]);

  async function requestAllPermissions() {
    if (!camPermission?.granted) await requestCam();
    if (Platform.OS === 'android') {
      const sdk = Platform.Version as number;
      if (sdk >= 31) {
        await PermissionsAndroid.requestMultiple([
          'android.permission.BLUETOOTH_SCAN',
          'android.permission.BLUETOOTH_CONNECT',
        ] as any);
      } else {
        await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION);
      }
    }
  }

  async function handleConnect() {
    if (demoMode) return;
    if (transport === 'wifi') {
      setStatus('Connecting');
      wsRef.current = connectIMUWS(wsUrl, (s) => handleSample(s), (st) => {
        if (st === 'connected') setStatus('Connected');
        if (st === 'closed' || st === 'error') { setStatus('Idle'); wsRef.current = null; }
      });
      return;
    }
    if (transport === 'ble') {
      try {
        setStatus('Scanning');
        const { ensurePoweredOn, scanForPhoenixIMU, connectAndSubscribe } = await import('../ble');
        await ensurePoweredOn();
        let picked: any = null;
        const stop = scanForPhoenixIMU((d: any) => { if (!picked) { picked = d; stop(); } }, 10000);
        const t0 = Date.now();
        while (!picked && Date.now() - t0 < 10050) { await new Promise(r => setTimeout(r, 100)); }
        if (!picked) { setStatus('Idle'); return; }
        setStatus('Connecting');
        const next = await connectAndSubscribe(picked, (s: any) => handleSample(s), () => { setStatus('Idle'); bleConnRef.current = undefined; });
        bleConnRef.current = next;
        setStatus('Connected');
      } catch { setStatus('Idle'); }
      return;
    }
    setStatus('Connected');
  }

  async function handleDisconnect() {
    if (transport === 'wifi') {
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
      setStatus('Idle');
      return;
    }
    if (transport === 'ble') {
      try {
        const { disconnectSafe, stopScan } = await import('../ble');
        stopScan();
        await disconnectSafe(bleConnRef.current);
      } catch {}
      bleConnRef.current = undefined;
      setStatus('Idle');
      return;
    }
    setStatus('Idle');
  }

  const connected = status === 'Connected';

  function startRecording() {
    if (!connected) {
      Alert.alert('Not connected', 'Connect to the IMU before recording.');
      return;
    }
    setMaxAccel(0);
    setRecording(true);
  }

  async function stopRecording() {
    if (!recording) return;
    setRecording(false);
    const maxA = maxAccel;
    if (!Number.isFinite(maxA) || maxA <= 0) {
      Alert.alert('No data', 'No acceleration data captured while recording.');
      return;
    }
    const user = auth.currentUser;
    if (!user) {
      Alert.alert('Not signed in', 'Sign in to save your recording.');
      return;
    }

    try {
      const colRef = collection(firestore, 'users', user.uid, 'workoutHistory');
      await addDoc(colRef, {
        workoutType: selectedWorkout,
        maxAcceleration: maxA,
        transport,
        createdAt: serverTimestamp(),
        fromDemo: demoMode,
      });
      Alert.alert('Saved', `Max acceleration: ${maxA.toFixed(2)} m/s²`);
    } catch (e) {
      Alert.alert('Save failed', 'Could not save this recording. Please try again.');
    }
  }

  return (
    <View style={styles.root}>
      <CameraView style={StyleSheet.absoluteFill} facing="back" />

      <View style={styles.overlay}>
        {/* Workout selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipsRow}>
          {(['Squat','Push Up','Deadlift'] as WorkoutKind[]).map(wk => (
            <TouchableOpacity key={wk} onPress={() => setSelectedWorkout(wk)} style={[styles.chip, selectedWorkout === wk && styles.chipSelected]}>
              <Text style={[styles.chipText, selectedWorkout === wk && styles.chipTextSelected]}>{wk}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Status + controls */}
        <View style={styles.headerRow}>
          <StatusPill status={status} />
          <View style={{ flexDirection: 'row' }}>
            <TouchableOpacity onPress={() => setDemoMode(d => !d)} style={[styles.btn, demoMode ? styles.btnInfo : styles.btnSecondary, { marginRight: 8 }]}>
              <Text style={styles.btnText}>{demoMode ? 'Demo On' : 'Demo Off'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={connected ? handleDisconnect : handleConnect} style={[styles.btn, connected ? styles.btnDanger : (demoMode ? styles.btnDisabled : styles.btnPrimary)]}>
              <Text style={styles.btnText}>{connected ? 'Disconnect' : 'Connect'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Transport & WS URL */}
        <View style={{ flexDirection: 'row', marginBottom: 8 }}>
          {(['demo','wifi','ble'] as const).map(t => (
            <TouchableOpacity key={t} onPress={() => setTransport(t)} style={[styles.btn, { marginRight: 8, backgroundColor: transport === t ? '#111827' : '#374151' }]}>
              <Text style={styles.btnText}>{t.toUpperCase()}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {transport === 'wifi' && (
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
            <Text style={{ color: '#E5E7EB', marginRight: 8 }}>WS URL</Text>
            <TextInput value={wsUrl} onChangeText={setWsUrl} placeholder="ws://192.168.4.1:81" autoCapitalize="none" autoCorrect={false} style={[styles.btn, { backgroundColor: '#111', color: '#fff', flex: 1 }]} />
          </View>
        )}

        {/* IMU telemetry card with workout title */}
        <View style={styles.card}>
          <Text style={styles.title}>{selectedWorkout} • IMU</Text>
          <View style={styles.row}>
            <Metric label="Yaw (°)" value={sample.y} />
            <Metric label="Pitch (°)" value={sample.p} />
            <Metric label="Roll (°)" value={sample.r} />
          </View>
          <View style={styles.row}>
            <Metric label="|a| (m/s²)" value={sample.am} />
            <Metric label="ax" value={sample.ax} />
            <Metric label="ay" value={sample.ay} />
            <Metric label="az" value={sample.az} />
          </View>
          <View style={[styles.row, { marginTop: 10 }]}>
            <TouchableOpacity
              onPress={startRecording}
              disabled={!connected || recording}
              style={[
                styles.btn,
                (!connected || recording) ? styles.btnDisabled : styles.btnPrimary,
                { marginRight: 8 },
              ]}
            >
              <Text style={styles.btnText}>Start Recording</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={stopRecording}
              disabled={!recording}
              style={[
                styles.btn,
                !recording ? styles.btnDisabled : styles.btnInfo,
              ]}
            >
              <Text style={styles.btnText}>Stop & Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

function StatusPill({ status, style }: { status: Status; style?: StyleProp<ViewStyle> }) {
  const color = status === 'Connected' ? '#10B981' : status === 'Connecting' ? '#F59E0B' : status === 'Scanning' ? '#3B82F6' : '#6B7280';
  return (
    <View style={[styles.pill, { backgroundColor: color }, style]}>
      <Text style={styles.pillText}>{status}</Text>
    </View>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{fmt(value)}</Text>
    </View>
  );
}

function fmt(n: number) { return (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2); }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: 16 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  pill: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 999 },
  pillText: { color: '#FFF', fontWeight: '700' },
  btn: { borderRadius: 999, paddingVertical: 10, paddingHorizontal: 16 },
  btnPrimary: { backgroundColor: '#111827' },
  btnSecondary: { backgroundColor: '#374151' },
  btnInfo: { backgroundColor: '#2563EB' },
  btnDisabled: { backgroundColor: '#6B7280' },
  btnDanger: { backgroundColor: '#EF4444' },
  btnText: { color: '#FFF', fontWeight: '700' },
  card: { backgroundColor: 'rgba(17,17,17,0.75)', borderRadius: 16, padding: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.08)' },
  title: { color: '#E5E7EB', fontWeight: '800', marginBottom: 8 },
  row: { flexDirection: 'row', marginTop: 6 },
  metricBox: { flex: 1, marginRight: 8 },
  metricLabel: { color: '#9CA3AF', fontSize: 12 },
  metricValue: { color: '#F9FAFB', fontSize: 20, fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any, marginTop: 2 },
  chipsRow: { paddingBottom: 8 },
  chip: { backgroundColor: '#E5E7EB', borderRadius: 999, paddingVertical: 8, paddingHorizontal: 14, marginRight: 8 },
  chipSelected: { backgroundColor: '#111827' },
  chipText: { fontWeight: '700', color: '#111' },
  chipTextSelected: { color: '#FFF' },
}); 