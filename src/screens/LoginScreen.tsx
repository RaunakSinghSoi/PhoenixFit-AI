import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../lib/firebase';

type Props = NativeStackScreenProps<any>;

export default function LoginScreen({ navigation }: Props) {
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleLogin() {
    const e = email.trim();
    const p = password;
    if (!e || !p) {
      setError('Enter email and password');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await signInWithEmailAndPassword(auth, e, p);
      // onAuthStateChanged in RootNavigator will take over
    } catch (err: any) {
      setError(err?.message || 'Failed to sign in');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.select({ ios: 'padding', android: undefined })}
    >
      <View style={styles.card}>
        <Text style={styles.title}>Welcome back</Text>

        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />

        <Text style={styles.label}>Password</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.primaryButton} onPress={handleLogin} disabled={loading}>
          <Text style={styles.primaryText}>{loading ? 'Signing in…' : 'Sign In'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('SignUp')} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Don&apos;t have an account? Sign up</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F7F7F9' },
  card: {
    width: '88%',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
  },
  title: { fontSize: 22, fontWeight: '800', marginBottom: 16, color: '#111827' },
  label: { fontSize: 12, color: '#6B7280', marginTop: 12, marginBottom: 4 },
  input: {
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#111827',
  },
  error: { color: '#DC2626', marginTop: 8, fontSize: 12 },
  primaryButton: {
    marginTop: 20,
    borderRadius: 999,
    backgroundColor: '#111827',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryButton: { marginTop: 12, alignItems: 'center' },
  secondaryText: { color: '#111827', fontSize: 13 },
});


