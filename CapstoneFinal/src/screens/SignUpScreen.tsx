import React from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform } from 'react-native';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, firestore } from '../lib/firebase';

type Props = NativeStackScreenProps<any>;

export default function SignUpScreen({ navigation }: Props) {
  const [name, setName] = React.useState('');
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  async function handleSignUp() {
    const n = name.trim();
    const e = email.trim();
    const p = password;
    const c = confirm;

    if (!n || !e || !p) {
      setError('Fill out all fields');
      return;
    }
    if (p.length < 6) {
      setError('Password must be at least 6 characters');
      return;
    }
    if (p !== c) {
      setError('Passwords do not match');
      return;
    }

    setError(null);
    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, e, p);
      if (auth.currentUser && n) {
        await updateProfile(auth.currentUser, { displayName: n });
      }

      const uid = cred.user.uid;
      const userRef = doc(firestore, 'users', uid);
      await setDoc(userRef, {
        uid,
        displayName: n,
        email: e.toLowerCase(),
        searchName: n.toLowerCase(),
        createdAt: serverTimestamp(),
      });
      // RootNavigator onAuthStateChanged will navigate into AppTabs
    } catch (err: any) {
      setError(err?.message || 'Failed to sign up');
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
        <Text style={styles.title}>Create your account</Text>

        <Text style={styles.label}>Name</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
        />

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

        <Text style={styles.label}>Confirm password</Text>
        <TextInput
          style={styles.input}
          value={confirm}
          onChangeText={setConfirm}
          secureTextEntry
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <TouchableOpacity style={styles.primaryButton} onPress={handleSignUp} disabled={loading}>
          <Text style={styles.primaryText}>{loading ? 'Creating account…' : 'Sign Up'}</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={styles.secondaryButton}>
          <Text style={styles.secondaryText}>Already have an account? Sign in</Text>
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


