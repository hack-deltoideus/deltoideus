export type PolarReading = {
  heartRate: number;
  rrMs?: number;
};

const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT_CHARACTERISTIC = 0x2a37;

export function parseHeartRateMeasurement(value: DataView): PolarReading {
  const flags = value.getUint8(0);
  const isHeartRate16Bit = (flags & 0x01) !== 0;

  let offset = 1;
  const heartRate = isHeartRate16Bit ? value.getUint16(offset, true) : value.getUint8(offset);
  offset += isHeartRate16Bit ? 2 : 1;

  const hasEnergyExpended = (flags & 0x08) !== 0;
  if (hasEnergyExpended) {
    offset += 2;
  }

  const hasRrInterval = (flags & 0x10) !== 0;
  let rrMs: number | undefined;
  if (hasRrInterval && value.byteLength >= offset + 2) {
    const rrRaw = value.getUint16(offset, true);
    rrMs = Math.round((rrRaw / 1024) * 1000);
  }

  return { heartRate, rrMs };
}

export async function connectHeartRateMonitor(
  onReading: (reading: PolarReading) => void
): Promise<() => Promise<void>> {
  const nav = navigator as Navigator & {
    bluetooth?: {
      requestDevice: (options: unknown) => Promise<any>;
    };
  };

  if (!nav.bluetooth) {
    throw new Error('Web Bluetooth is not available in this browser.');
  }

  const device = await nav.bluetooth.requestDevice({
    filters: [{ services: [HEART_RATE_SERVICE] }],
    optionalServices: [HEART_RATE_SERVICE]
  });

  const server = await device.gatt?.connect();
  if (!server) {
    throw new Error('Could not connect to Bluetooth GATT server.');
  }

  const service = await server.getPrimaryService(HEART_RATE_SERVICE);
  const characteristic = await service.getCharacteristic(HEART_RATE_MEASUREMENT_CHARACTERISTIC);

  const handler = (event: Event) => {
    const target = event.target as BluetoothCharacteristicWithValue;
    const value = target.value;
    if (!value) {
      return;
    }

    onReading(parseHeartRateMeasurement(value));
  };

  characteristic.addEventListener('characteristicvaluechanged', handler);
  await characteristic.startNotifications();

  return async () => {
    characteristic.removeEventListener('characteristicvaluechanged', handler);
    await characteristic.stopNotifications();
    device.gatt?.disconnect();
  };
}

type BluetoothCharacteristicWithValue = EventTarget & {
  value: DataView | null;
};
