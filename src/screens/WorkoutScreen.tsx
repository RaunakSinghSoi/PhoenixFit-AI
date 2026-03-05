import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Platform, PermissionsAndroid, StyleProp, ViewStyle, TextInput, Alert } from 'react-native';
import { connectIMUWS, IMUSample as IMUSampleWS, WsConn } from '../imuWs';
import { auth, firestore } from '../lib/firebase';
import { addDoc, collection, serverTimestamp } from 'firebase/firestore';

type Status = 'Idle' | 'Connecting' | 'Connected';

export default function WorkoutScreen() {
  const [status, setStatus] = React.useState<Status>('Idle');
  const [sample, setSample] = React.useState<IMUSampleWS>({ y: 0, p: 0, r: 0, ax: 0, ay: 0, az: 0, am: 0 });
  const [wsUrl, setWsUrl] = React.useState<string>('ws://192.168.4.1:81');
  const wsRef = React.useRef<WsConn | null>(null);
  const [recording, setRecording] = React.useState(false);
  const [maxAccel, setMaxAccel] = React.useState(0);

  React.useEffect(() => {
    return () => {
      try { wsRef.current?.close(); } catch {}
    };
  }, []);

  function handleSample(s: IMUSampleWS) {
    setSample(s);
    if (recording) {
      setMaxAccel(prev => Math.max(prev, s.am));
    }
  }

  function handleConnect() {
    if (status === 'Connected') return;
    setStatus('Connecting');
    wsRef.current = connectIMUWS(wsUrl, (s) => handleSample(s), (st) => {
      if (st === 'connected') setStatus('Connected');
      if (st === 'closed' || st === 'error') { setStatus('Idle'); wsRef.current = null; }
    });
  }

  function handleDisconnect() {
    try { wsRef.current?.close(); } catch {}
    wsRef.current = null;
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
        workoutType: 'IMU Recording',
        maxAcceleration: maxA,
        transport: 'wifi',
        createdAt: serverTimestamp(),
      });
      Alert.alert('Saved', `Max acceleration: ${maxA.toFixed(2)} m/s²`);
    } catch (e) {
      Alert.alert('Save failed', 'Could not save this recording. Please try again.');
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.container}>
        {/* Header */}
        <Text style={styles.header}>IMU Sensor</Text>
        
        {/* Connection Status */}
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: connected ? '#10B981' : status === 'Connecting' ? '#F59E0B' : '#6B7280' }]} />
          <Text style={styles.statusText}>{status}</Text>
        </View>

        {/* WebSocket URL Input */}
        <View style={styles.urlRow}>
          <Text style={styles.label}>WebSocket URL</Text>
          <TextInput
            value={wsUrl}
            onChangeText={setWsUrl}
            placeholder="ws://192.168.4.1:81"
            placeholderTextColor="#6B7280"
            autoCapitalize="none"
            autoCorrect={false}
            style={styles.input}
          />
        </View>

        {/* Connect/Disconnect Button */}
        <TouchableOpacity
          onPress={connected ? handleDisconnect : handleConnect}
          style={[styles.btn, connected ? styles.btnDanger : styles.btnPrimary]}
        >
          <Text style={styles.btnText}>{connected ? 'Disconnect' : 'Connect'}</Text>
        </TouchableOpacity>

        {/* IMU Data Card */}
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Live Data</Text>
          
          <View style={styles.dataGrid}>
            <View style={styles.dataItem}>
              <Text style={styles.dataLabel}>Accel Mag</Text>
              <Text style={styles.dataValue}>{sample.am.toFixed(2)}</Text>
              <Text style={styles.dataUnit}>m/s²</Text>
            </View>
            <View style={styles.dataItem}>
              <Text style={styles.dataLabel}>Yaw</Text>
              <Text style={styles.dataValue}>{sample.y.toFixed(1)}</Text>
              <Text style={styles.dataUnit}>deg</Text>
            </View>
            <View style={styles.dataItem}>
              <Text style={styles.dataLabel}>Pitch</Text>
              <Text style={styles.dataValue}>{sample.p.toFixed(1)}</Text>
              <Text style={styles.dataUnit}>deg</Text>
            </View>
            <View style={styles.dataItem}>
              <Text style={styles.dataLabel}>Roll</Text>
              <Text style={styles.dataValue}>{sample.r.toFixed(1)}</Text>
              <Text style={styles.dataUnit}>deg</Text>
            </View>
          </View>

          <View style={styles.accelRow}>
            <View style={styles.accelItem}>
              <Text style={styles.accelLabel}>ax</Text>
              <Text style={styles.accelValue}>{sample.ax.toFixed(2)}</Text>
            </View>
            <View style={styles.accelItem}>
              <Text style={styles.accelLabel}>ay</Text>
              <Text style={styles.accelValue}>{sample.ay.toFixed(2)}</Text>
            </View>
            <View style={styles.accelItem}>
              <Text style={styles.accelLabel}>az</Text>
              <Text style={styles.accelValue}>{sample.az.toFixed(2)}</Text>
            </View>
          </View>
        </View>

        {/* Recording Controls */}
        <View style={styles.recordingSection}>
          {recording && (
            <View style={styles.recordingIndicator}>
              <View style={styles.recordingDot} />
              <Text style={styles.recordingText}>Recording... Max: {maxAccel.toFixed(2)} m/s²</Text>
            </View>
          )}
          <View style={styles.recordingButtons}>
            <TouchableOpacity
              onPress={startRecording}
              disabled={!connected || recording}
              style={[styles.btn, styles.btnSmall, (!connected || recording) ? styles.btnDisabled : styles.btnPrimary]}
            >
              <Text style={styles.btnText}>Start</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={stopRecording}
              disabled={!recording}
              style={[styles.btn, styles.btnSmall, !recording ? styles.btnDisabled : styles.btnDanger]}
            >
              <Text style={styles.btnText}>Stop & Save</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  container: { flex: 1, padding: 20, paddingTop: 60 },
  header: { fontSize: 28, fontWeight: '800', color: '#FFF', marginBottom: 20 },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  statusDot: { width: 12, height: 12, borderRadius: 6, marginRight: 10 },
  statusText: { color: '#E5E7EB', fontSize: 16, fontWeight: '600' },
  urlRow: { marginBottom: 16 },
  label: { color: '#9CA3AF', fontSize: 12, fontWeight: '600', marginBottom: 6 },
  input: { backgroundColor: '#1F2937', borderRadius: 10, padding: 14, color: '#FFF', fontSize: 14, borderWidth: 1, borderColor: '#374151' },
  btn: { borderRadius: 10, paddingVertical: 14, paddingHorizontal: 20, alignItems: 'center', marginBottom: 16 },
  btnSmall: { flex: 1, marginHorizontal: 6, marginBottom: 0 },
  btnPrimary: { backgroundColor: '#10B981' },
  btnDisabled: { backgroundColor: '#374151' },
  btnDanger: { backgroundColor: '#EF4444' },
  btnText: { color: '#FFF', fontWeight: '700', fontSize: 15 },
  card: { backgroundColor: '#1F2937', borderRadius: 16, padding: 20, marginBottom: 20 },
  cardTitle: { color: '#9CA3AF', fontSize: 12, fontWeight: '700', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 1 },
  dataGrid: { flexDirection: 'row', flexWrap: 'wrap', marginBottom: 16 },
  dataItem: { width: '50%', marginBottom: 16 },
  dataLabel: { color: '#6B7280', fontSize: 11, fontWeight: '600' },
  dataValue: { color: '#FFF', fontSize: 28, fontWeight: '800', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any },
  dataUnit: { color: '#6B7280', fontSize: 11 },
  accelRow: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: '#374151', paddingTop: 16 },
  accelItem: { flex: 1, alignItems: 'center' },
  accelLabel: { color: '#6B7280', fontSize: 11, fontWeight: '600' },
  accelValue: { color: '#9CA3AF', fontSize: 16, fontWeight: '600', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) as any },
  recordingSection: { marginTop: 'auto' },
  recordingIndicator: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  recordingDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#EF4444', marginRight: 8 },
  recordingText: { color: '#EF4444', fontSize: 14, fontWeight: '600' },
  recordingButtons: { flexDirection: 'row' },
}); 