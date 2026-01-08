// Load CalorieNinjas API key from .env and expose via expo.extra
// Keep this minimal to avoid bundling secrets; only expose the needed key.
try {
  // Optional: Load .env if available; don't crash if missing
  require('dotenv').config();
} catch {}

/** @type {import('@expo/config').ExpoConfig} */
module.exports = ({ config }) => ({
  ...config,
  name: config?.name || 'PhoenixFitAI',
  slug: config?.slug || 'PhoenixFitAI',
  extra: {
    ...config?.extra,
    // Support either env var name
    CALORIE_NINJAS_API_KEY: process.env.API_NINJAS_API_KEY || process.env.CALORIE_NINJAS_API_KEY || null,
    API_NINJAS_API_KEY: process.env.API_NINJAS_API_KEY || process.env.CALORIE_NINJAS_API_KEY || null,
    // USDA FoodData Central key
    USDA_API_KEY: process.env.USDA_API_KEY || process.env.FOODDATA_API_KEY || null,
    FOODDATA_API_KEY: process.env.FOODDATA_API_KEY || process.env.USDA_API_KEY || null,
    // Provide a flag to help the app detect missing keys at runtime
    hasCalorieNinjasKey: Boolean(process.env.API_NINJAS_API_KEY || process.env.CALORIE_NINJAS_API_KEY),
    hasUsdaKey: Boolean(process.env.USDA_API_KEY || process.env.FOODDATA_API_KEY),
    eas: {
      projectId: config?.extra?.eas?.projectId,
    },
  },
  android: {
    ...(config.android || {}),
    permissions: [
      'android.permission.BLUETOOTH_SCAN',
      'android.permission.BLUETOOTH_CONNECT',
      'android.permission.ACCESS_FINE_LOCATION',
      'android.permission.CAMERA',
    ],
  },
  ios: {
    ...(config.ios || {}),
    infoPlist: {
      ...(config.ios?.infoPlist || {}),
      NSBluetoothAlwaysUsageDescription: 'This app uses Bluetooth to connect to the IMU.',
      NSBluetoothPeripheralUsageDescription: 'This app uses Bluetooth to connect to the IMU.',
      NSCameraUsageDescription: 'Camera is used to display the live preview.',
    },
  },
});


