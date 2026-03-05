import Constants from 'expo-constants';

const extra =
  (Constants?.expoConfig?.extra as Record<string, any> | undefined) ??
  (Constants?.manifest?.extra as Record<string, any> | undefined) ??
  {};

const hostUri: string | undefined =
  (Constants?.expoConfig?.hostUri as string | undefined) ??
  (Constants?.manifest?.hostUri as string | undefined);

let derivedBase = 'http://127.0.0.1:8000';
if (hostUri) {
  const host = hostUri.split(':')[0];
  if (host && host !== 'exp') {
    derivedBase = `http://${host}:8000`;
  }
}

const FALLBACK_BASE_URL = derivedBase;

export const FASTAPI_BASE_URL: string =
  typeof extra?.FASTAPI_BASE_URL === 'string' && extra.FASTAPI_BASE_URL.trim().length > 0
    ? extra.FASTAPI_BASE_URL.trim()
    : FALLBACK_BASE_URL;

export const FASTAPI_ANALYZE_URL = `${FASTAPI_BASE_URL}/analyze-frame`;
export const FASTAPI_HEALTH_URL = `${FASTAPI_BASE_URL}/health`;

