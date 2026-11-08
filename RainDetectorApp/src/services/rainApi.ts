import Constants from 'expo-constants';
import { Platform } from 'react-native';

export interface RainReading {
  level: 'DRY' | 'LIGHT' | 'HEAVY' | 'STOPPED';
  value: number;
  delta: number;
  intensity: number;
  muted: boolean;
  updated: string;
  online: boolean;
}

export interface RainApiResponse {
  level?: 'DRY' | 'LIGHT' | 'HEAVY' | 'STOPPED';
  value?: number;
  delta?: number;
  intensity?: number;
  muted?: boolean;
  updated?: string;
  online: boolean;
  error?: string;
}

/**
 * Determine default backend API URL based on platform and Expo network host.
 */
export function getDefaultApiUrl(): string {
  if (process.env.EXPO_PUBLIC_API_URL) {
    return process.env.EXPO_PUBLIC_API_URL;
  }

  // If running via Expo Go / development build on a physical phone or simulator:
  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri) {
    const host = hostUri.split(':')[0];
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      return `http://${host}:8000`;
    }
  }

  // Android emulator host loopback
  if (Platform.OS === 'android') {
    return 'http://192.168.0.101:8000';
  }

  // iOS simulator or Web
  if (Platform.OS === 'web') {
    return 'http://localhost:8000';
  }

  // Default fallback to machine local LAN IP
  return 'http://192.168.0.101:8000';
}

/**
 * Fetch latest sensor reading from GET /api/rain/latest
 */
export async function fetchLatestRain(baseUrl: string): Promise<RainApiResponse> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/rain/latest`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 4000);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data: RainApiResponse = await res.json();
    return data;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Trigger backend simulation endpoint POST /api/rain/simulate
 */
export async function simulateRainReading(baseUrl: string): Promise<{ ok: boolean }> {
  const url = `${baseUrl.replace(/\/+$/, '')}/api/rain/simulate`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Simulation failed: HTTP ${res.status}`);
  }

  return res.json();
}
