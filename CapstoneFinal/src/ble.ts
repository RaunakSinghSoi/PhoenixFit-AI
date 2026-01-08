import { BleManager, Device, Subscription } from 'react-native-ble-plx';
import { Buffer } from 'buffer';
// Ensure Buffer exists at runtime in React Native
if (typeof (global as any).Buffer === 'undefined') {
  (global as any).Buffer = Buffer;
}

export const BLE_DEVICE_NAME = 'PhoenixIMU';
export const SERVICE_UUID = '0000FFF0-0000-1000-8000-00805F9B34FB';
export const CHAR_UUID = '0000FFF1-0000-1000-8000-00805F9B34FB';

export type IMUSample = {
  y: number; p: number; r: number;
  ax: number; ay: number; az: number; am: number;
};

export type Connection = {
  device: Device;
  monitorSub: Subscription;
  onDisconnectSub?: Subscription;
};

const manager = new BleManager();

export async function ensurePoweredOn(): Promise<void> {
  const state = await manager.state();
  if (state === 'PoweredOn') return;
  return new Promise((resolve) => {
    const sub = manager.onStateChange((s) => {
      if (s === 'PoweredOn') {
        sub.remove();
        resolve();
      }
    }, true);
  });
}

export function scanForPhoenixIMU(
  onFound: (device: Device) => void,
  timeoutMs = 10000
): () => void {
  let stopped = false;
  manager.startDeviceScan([SERVICE_UUID], { allowDuplicates: false }, (error, device) => {
    if (error) { return; }
    if (!device) return;
    if (device.name === BLE_DEVICE_NAME || (device.serviceUUIDs || []).includes(SERVICE_UUID)) {
      onFound(device);
    }
  });
  const stop = () => { if (!stopped) { stopped = true; manager.stopDeviceScan(); } };
  setTimeout(stop, timeoutMs);
  return stop;
}

export async function connectAndSubscribe(
  device: Device,
  onSample: (sample: IMUSample) => void,
  onDisconnected?: () => void
): Promise<Connection> {
  const connected = await device.connect();
  await connected.discoverAllServicesAndCharacteristics();

  const onDisconnectSub = connected.onDisconnected(() => { try { onDisconnected && onDisconnected(); } catch {} });

  const monitorSub = connected.monitorCharacteristicForService(
    SERVICE_UUID,
    CHAR_UUID,
    (error, characteristic) => {
      if (error || !characteristic?.value) return;
      try {
        const json = Buffer.from(characteristic.value, 'base64').toString('utf8');
        const parsed = JSON.parse(json) as Partial<IMUSample>;
        if (typeof parsed.y === 'number') {
          onSample({
            y: parsed.y || 0,
            p: parsed.p || 0,
            r: parsed.r || 0,
            ax: parsed.ax || 0,
            ay: parsed.ay || 0,
            az: parsed.az || 0,
            am: parsed.am || 0,
          });
        }
      } catch {}
    }
  );

  return { device: connected, monitorSub, onDisconnectSub };
}

export async function disconnectSafe(conn?: Connection) {
  try { conn?.monitorSub?.remove(); } catch {}
  try { conn?.onDisconnectSub?.remove(); } catch {}
  try {
    if (conn?.device && (await conn.device.isConnected())) {
      await conn.device.cancelConnection();
    }
  } catch {}
}

export function stopScan() { manager.stopDeviceScan(); }


