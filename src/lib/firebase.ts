import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, initializeAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getDatabase } from 'firebase/database';
import AsyncStorage from '@react-native-async-storage/async-storage';
const firebaseConfig = {
  apiKey: 'AIzaSyCKG0-SYJS38dMMAsluK_klikAc-03ply0',
  authDomain: 'pheonix-dabdc.firebaseapp.com',
  databaseURL: 'https://pheonix-dabdc-default-rtdb.firebaseio.com/',
  projectId: 'pheonix-dabdc',
  storageBucket: 'pheonix-dabdc.firebasestorage.app',
  messagingSenderId: '493528952873',
  appId: '1:493528952873:web:85bfc6f28652641df92c38',
};

// getReactNativePersistence is available at runtime but not typed in some setups,
// so we access it via require to avoid TS issues.
const { getReactNativePersistence } = require('firebase/auth') as any;

let app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Use persistent auth state on React Native
let authInstance;
if (getApps().length === 1) {
  // First time initialization in this JS runtime
  authInstance = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} else {
  // App already initialized (e.g. Fast Refresh) – reuse existing auth
  authInstance = getAuth(app);
}

export const auth = authInstance;
export const firestore = getFirestore(app);
export const rtdb = getDatabase(app);


