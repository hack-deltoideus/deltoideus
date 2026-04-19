export type PolarReading = {
	heartRate: number;
	rrMs?: number;
	hrvMs?: number;
	rrIntervalsMs?: number[];
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

type BluetoothCharacteristicWithValue = EventTarget & {
  value: DataView | null;
};
