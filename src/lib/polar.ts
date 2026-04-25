export type PolarReading = {
  heartRate: number;
  rrMs?: number;
  hrvMs?: number;
  rrIntervalsMs?: number[];
};

export type PolarEcgSample = {
  microvolts: number;
  sampleIndex: number;
  estimatedOffsetMs: number;
};

export type PolarEcgPacket = {
  measurementType: number;
  frameType: number;
  timestampNs: bigint;
  samples: PolarEcgSample[];
  rawBytes: number[];
};

const HEART_RATE_SERVICE = 0x180d;
const HEART_RATE_MEASUREMENT_CHARACTERISTIC = 0x2a37;
const POLAR_PMD_SERVICE = 'fb005c80-02e7-f387-1cad-8acd2d8df0c8';
const POLAR_PMD_CONTROL_CHARACTERISTIC = 'fb005c81-02e7-f387-1cad-8acd2d8df0c8';
const POLAR_PMD_DATA_CHARACTERISTIC = 'fb005c82-02e7-f387-1cad-8acd2d8df0c8';

const PMD_MEASUREMENT_ECG = 0x00;
const PMD_CONTROL_REQUEST_STREAM_SETTINGS = 0x01;
const PMD_CONTROL_START_MEASUREMENT = 0x02;
const POLAR_H10_ECG_SAMPLE_RATE_HZ = 130;

export const POLAR_PMD_UUIDS = {
  service: POLAR_PMD_SERVICE,
  control: POLAR_PMD_CONTROL_CHARACTERISTIC,
  data: POLAR_PMD_DATA_CHARACTERISTIC
} as const;

export const POLAR_H10_ECG_START_COMMAND = Uint8Array.from([
  PMD_CONTROL_START_MEASUREMENT,
  PMD_MEASUREMENT_ECG,
  0x00,
  0x01,
  0x82,
  0x00,
  0x01,
  0x01,
  0x0e,
  0x00
]);

export const POLAR_H10_ECG_SETTINGS_COMMAND = Uint8Array.from([
  PMD_CONTROL_REQUEST_STREAM_SETTINGS,
  PMD_MEASUREMENT_ECG
]);

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
  let rrIntervalsMs: number[] | undefined;
  if (hasRrInterval && value.byteLength >= offset + 2) {
    rrIntervalsMs = [];
    while (offset + 1 < value.byteLength) {
      const rrRaw = value.getUint16(offset, true);
      rrIntervalsMs.push(Math.round((rrRaw / 1024) * 1000));
      offset += 2;
    }
    rrMs = rrIntervalsMs.at(-1);
  }

  return { heartRate, rrMs, rrIntervalsMs };
}

function calculateRmssd(rrHistory: number[]): number | undefined {
  if (rrHistory.length < 2) {
    return undefined;
  }

  let squaredDiffTotal = 0;
  for (let index = 1; index < rrHistory.length; index += 1) {
    const diff = rrHistory[index] - rrHistory[index - 1];
    squaredDiffTotal += diff * diff;
  }

  return Number(Math.sqrt(squaredDiffTotal / (rrHistory.length - 1)).toFixed(2));
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
  const recentRrIntervals: number[] = [];

  const handler = (event: Event) => {
    const target = event.target as BluetoothCharacteristicWithValue;
    const value = target.value;
    if (!value) {
      return;
    }

    const reading = parseHeartRateMeasurement(value);

    if (reading.rrIntervalsMs?.length) {
      recentRrIntervals.push(...reading.rrIntervalsMs);
      while (recentRrIntervals.length > 30) {
        recentRrIntervals.shift();
      }

      reading.hrvMs = calculateRmssd(recentRrIntervals);
    }

    onReading(reading);
  };

  characteristic.addEventListener('characteristicvaluechanged', handler);
  await characteristic.startNotifications();

  return async () => {
    characteristic.removeEventListener('characteristicvaluechanged', handler);
    await characteristic.stopNotifications();
    device.gatt?.disconnect();
  };
}

export async function connectPolarEcgStream(
  onPacket: (packet: PolarEcgPacket) => void
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
    filters: [{ namePrefix: 'Polar H10' }, { namePrefix: 'Polar H9' }, { namePrefix: 'Polar' }],
    optionalServices: [POLAR_PMD_SERVICE]
  });

  const server = await device.gatt?.connect();
  if (!server) {
    throw new Error('Could not connect to Bluetooth GATT server.');
  }

  const service = await server.getPrimaryService(POLAR_PMD_SERVICE);
  const controlCharacteristic = await service.getCharacteristic(POLAR_PMD_CONTROL_CHARACTERISTIC);
  const dataCharacteristic = await service.getCharacteristic(POLAR_PMD_DATA_CHARACTERISTIC);

  const handler = (event: Event) => {
    const target = event.target as BluetoothCharacteristicWithValue;
    const value = target.value;
    if (!value) {
      return;
    }

    const packet = parsePolarEcgPacket(value);
    if (packet) {
      onPacket(packet);
    }
  };

  dataCharacteristic.addEventListener('characteristicvaluechanged', handler);
  await dataCharacteristic.startNotifications();
  await controlCharacteristic.writeValue(POLAR_H10_ECG_SETTINGS_COMMAND);
  await controlCharacteristic.writeValue(POLAR_H10_ECG_START_COMMAND);

  return async () => {
    dataCharacteristic.removeEventListener('characteristicvaluechanged', handler);
    await dataCharacteristic.stopNotifications();
    device.gatt?.disconnect();
  };
}

export function parsePolarEcgPacket(value: DataView): PolarEcgPacket | null {
  if (value.byteLength < 10) {
    return null;
  }

  const measurementType = value.getUint8(0);
  if (measurementType !== PMD_MEASUREMENT_ECG) {
    return null;
  }

  const timestampNs = readLittleEndianUint64(value, 1);
  const frameType = value.getUint8(9);
  const samples: PolarEcgSample[] = [];
  const sampleIntervalMs = 1000 / POLAR_H10_ECG_SAMPLE_RATE_HZ;

  for (let offset = 10; offset + 2 < value.byteLength; offset += 3) {
    const sampleIndex = samples.length;
    samples.push({
      microvolts: readSigned24LittleEndian(value, offset),
      sampleIndex,
      estimatedOffsetMs: Number((sampleIndex * sampleIntervalMs).toFixed(3))
    });
  }

  return {
    measurementType,
    frameType,
    timestampNs,
    samples,
    rawBytes: Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength))
  };
}

function readSigned24LittleEndian(value: DataView, offset: number): number {
  const unsigned =
    value.getUint8(offset) | (value.getUint8(offset + 1) << 8) | (value.getUint8(offset + 2) << 16);

  return unsigned & 0x800000 ? unsigned - 0x1000000 : unsigned;
}

function readLittleEndianUint64(value: DataView, offset: number): bigint {
  let result = 0n;
  for (let index = 0; index < 8; index += 1) {
    result |= BigInt(value.getUint8(offset + index)) << BigInt(index * 8);
  }

  return result;
}

type BluetoothCharacteristicWithValue = EventTarget & {
  value: DataView | null;
};
