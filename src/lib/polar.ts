export type PolarReading = {
	heartRate: number;
	rrMs?: number;
	rrSeriesMs: number[];
	energyExpendedKj?: number;
	contactDetected?: boolean;
	timestamp: number;
};

export type PolarDeviceInfo = {
	manufacturerName?: string;
	modelNumber?: string;
	serialNumber?: string;
	hardwareRevision?: string;
	firmwareRevision?: string;
	softwareRevision?: string;
};

export type PolarCapabilities = {
	heartRate: boolean;
	rrIntervals: boolean;
	batteryLevel: boolean;
	bodySensorLocation: boolean;
	deviceInformation: boolean;
	polarMeasurementData: boolean;
	accelerometer: boolean;
	ecg: boolean;
};

export type PolarConnection = {
	deviceName: string;
	getCapabilities: () => PolarCapabilities;
	readBatteryLevel: () => Promise<number | undefined>;
	readBodySensorLocation: () => Promise<string | undefined>;
	readDeviceInfo: () => Promise<PolarDeviceInfo>;
	stop: () => Promise<void>;
};

const HEART_RATE_SERVICE = 0x180d;
const BATTERY_SERVICE = 0x180f;
const DEVICE_INFORMATION_SERVICE = 0x180a;
const HEART_RATE_MEASUREMENT_CHARACTERISTIC = 0x2a37;
const BODY_SENSOR_LOCATION_CHARACTERISTIC = 0x2a38;
const BATTERY_LEVEL_CHARACTERISTIC = 0x2a19;
const MANUFACTURER_NAME_CHARACTERISTIC = 0x2a29;
const MODEL_NUMBER_CHARACTERISTIC = 0x2a24;
const SERIAL_NUMBER_CHARACTERISTIC = 0x2a25;
const HARDWARE_REVISION_CHARACTERISTIC = 0x2a27;
const FIRMWARE_REVISION_CHARACTERISTIC = 0x2a26;
const SOFTWARE_REVISION_CHARACTERISTIC = 0x2a28;
const POLAR_PMD_SERVICE = 'fb005c80-02e7-f387-1cad-8acd2d8df0c8';
const RR_SCALE = 1000 / 1024;

const BODY_SENSOR_LOCATIONS: Record<number, string> = {
	0: 'Other',
	1: 'Chest',
	2: 'Wrist',
	3: 'Finger',
	4: 'Hand',
	5: 'Ear Lobe',
	6: 'Foot'
};

export function parseHeartRateMeasurement(value: DataView): PolarReading {
	const flags = value.getUint8(0);
	const isHeartRate16Bit = (flags & 0x01) !== 0;
	const contactDetected = (flags & 0x02) !== 0;
	const contactSupported = (flags & 0x04) !== 0;
	const hasEnergyExpended = (flags & 0x08) !== 0;
	const hasRrInterval = (flags & 0x10) !== 0;

	let offset = 1;
	const heartRate = isHeartRate16Bit ? value.getUint16(offset, true) : value.getUint8(offset);
	offset += isHeartRate16Bit ? 2 : 1;

	let energyExpendedKj: number | undefined;
	if (hasEnergyExpended && value.byteLength >= offset + 2) {
		energyExpendedKj = value.getUint16(offset, true);
		offset += 2;
	}

	const rrSeriesMs: number[] = [];
	while (hasRrInterval && value.byteLength >= offset + 2) {
		const rrRaw = value.getUint16(offset, true);
		rrSeriesMs.push(Math.round(rrRaw * RR_SCALE));
		offset += 2;
	}

	return {
		heartRate,
		rrMs: rrSeriesMs[0],
		rrSeriesMs,
		energyExpendedKj,
		contactDetected: contactSupported ? contactDetected : undefined,
		timestamp: Date.now()
	};
}

export async function connectHeartRateMonitor(
	onReading: (reading: PolarReading) => void,
	onDisconnected?: () => void
): Promise<PolarConnection> {
	const nav = navigator as Navigator & {
		bluetooth?: {
			requestDevice: (options: unknown) => Promise<BluetoothDeviceWithGatt>;
		};
	};

	if (!nav.bluetooth) {
		throw new Error('Web Bluetooth is not available in this browser.');
	}

	const device = await nav.bluetooth.requestDevice({
		filters: [{ services: [HEART_RATE_SERVICE] }],
		optionalServices: [HEART_RATE_SERVICE, BATTERY_SERVICE, DEVICE_INFORMATION_SERVICE, POLAR_PMD_SERVICE]
	});

	const server = await device.gatt?.connect();
	if (!server) {
		throw new Error('Could not connect to Bluetooth GATT server.');
	}

	const heartRateService = await server.getPrimaryService(HEART_RATE_SERVICE);
	const heartRateCharacteristic = await heartRateService.getCharacteristic(
		HEART_RATE_MEASUREMENT_CHARACTERISTIC
	);

	const capabilities = await detectCapabilities(server);

	const handler = (event: Event) => {
		const target = event.target as BluetoothCharacteristicWithValue;
		const value = target.value;
		if (!value) {
			return;
		}

		onReading(parseHeartRateMeasurement(value));
	};

	const disconnectHandler = () => {
		onDisconnected?.();
	};

	device.addEventListener?.('gattserverdisconnected', disconnectHandler);
	heartRateCharacteristic.addEventListener('characteristicvaluechanged', handler);
	await heartRateCharacteristic.startNotifications();

	return {
		deviceName: device.name || 'Polar H9',
		getCapabilities: () => capabilities,
		readBatteryLevel: async () => readBatteryLevel(server),
		readBodySensorLocation: async () => readBodySensorLocation(heartRateService),
		readDeviceInfo: async () => readDeviceInformation(server),
		stop: async () => {
			heartRateCharacteristic.removeEventListener('characteristicvaluechanged', handler);
			device.removeEventListener?.('gattserverdisconnected', disconnectHandler);
			await heartRateCharacteristic.stopNotifications();
			device.gatt?.disconnect();
		}
	};
}

async function detectCapabilities(server: BluetoothRemoteGATTServerLike): Promise<PolarCapabilities> {
	const heartRateService = await safeGetPrimaryService(server, HEART_RATE_SERVICE);
	const batteryService = await safeGetPrimaryService(server, BATTERY_SERVICE);
	const deviceInformationService = await safeGetPrimaryService(server, DEVICE_INFORMATION_SERVICE);
	const polarMeasurementDataService = await safeGetPrimaryService(server, POLAR_PMD_SERVICE);

	const rrCharacteristic = heartRateService
		? await safeGetCharacteristic(heartRateService, HEART_RATE_MEASUREMENT_CHARACTERISTIC)
		: undefined;
	const bodySensorLocationCharacteristic = heartRateService
		? await safeGetCharacteristic(heartRateService, BODY_SENSOR_LOCATION_CHARACTERISTIC)
		: undefined;
	const batteryCharacteristic = batteryService
		? await safeGetCharacteristic(batteryService, BATTERY_LEVEL_CHARACTERISTIC)
		: undefined;

	return {
		heartRate: rrCharacteristic !== undefined,
		rrIntervals: rrCharacteristic !== undefined,
		batteryLevel: batteryCharacteristic !== undefined,
		bodySensorLocation: bodySensorLocationCharacteristic !== undefined,
		deviceInformation: deviceInformationService !== undefined,
		polarMeasurementData: polarMeasurementDataService !== undefined,
		accelerometer: false,
		ecg: false
	};
}

async function readBatteryLevel(
	server: BluetoothRemoteGATTServerLike
): Promise<number | undefined> {
	const service = await safeGetPrimaryService(server, BATTERY_SERVICE);
	if (!service) {
		return undefined;
	}

	const characteristic = await safeGetCharacteristic(service, BATTERY_LEVEL_CHARACTERISTIC);
	if (!characteristic) {
		return undefined;
	}

	const value = await characteristic.readValue();
	return value.getUint8(0);
}

async function readBodySensorLocation(
	heartRateService: BluetoothRemoteGATTServiceLike
): Promise<string | undefined> {
	const characteristic = await safeGetCharacteristic(
		heartRateService,
		BODY_SENSOR_LOCATION_CHARACTERISTIC
	);
	if (!characteristic) {
		return undefined;
	}

	const value = await characteristic.readValue();
	return BODY_SENSOR_LOCATIONS[value.getUint8(0)] ?? `Unknown (${value.getUint8(0)})`;
}

async function readDeviceInformation(
	server: BluetoothRemoteGATTServerLike
): Promise<PolarDeviceInfo> {
	const service = await safeGetPrimaryService(server, DEVICE_INFORMATION_SERVICE);
	if (!service) {
		return {};
	}

	return {
		manufacturerName: await readUtf8Characteristic(service, MANUFACTURER_NAME_CHARACTERISTIC),
		modelNumber: await readUtf8Characteristic(service, MODEL_NUMBER_CHARACTERISTIC),
		serialNumber: await readUtf8Characteristic(service, SERIAL_NUMBER_CHARACTERISTIC),
		hardwareRevision: await readUtf8Characteristic(service, HARDWARE_REVISION_CHARACTERISTIC),
		firmwareRevision: await readUtf8Characteristic(service, FIRMWARE_REVISION_CHARACTERISTIC),
		softwareRevision: await readUtf8Characteristic(service, SOFTWARE_REVISION_CHARACTERISTIC)
	};
}

async function readUtf8Characteristic(
	service: BluetoothRemoteGATTServiceLike,
	characteristic: BluetoothServiceIdentifier
): Promise<string | undefined> {
	const target = await safeGetCharacteristic(service, characteristic);
	if (!target) {
		return undefined;
	}

	const value = await target.readValue();
	return decodeUtf8(value);
}

async function safeGetPrimaryService(
	server: BluetoothRemoteGATTServerLike,
	service: BluetoothServiceIdentifier
): Promise<BluetoothRemoteGATTServiceLike | undefined> {
	try {
		return await server.getPrimaryService(service);
	} catch {
		return undefined;
	}
}

async function safeGetCharacteristic(
	service: BluetoothRemoteGATTServiceLike,
	characteristic: BluetoothCharacteristicIdentifier
): Promise<BluetoothCharacteristicWithRead | undefined> {
	try {
		return await service.getCharacteristic(characteristic);
	} catch {
		return undefined;
	}
}

function decodeUtf8(value: DataView): string | undefined {
	const bytes = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	const text = new TextDecoder().decode(bytes).trim();
	return text || undefined;
}

type BluetoothCharacteristicWithValue = EventTarget & {
	value: DataView | null;
};

type BluetoothDeviceWithGatt = EventTarget & {
	name?: string;
	gatt?: {
		connect: () => Promise<BluetoothRemoteGATTServerLike>;
		disconnect: () => void;
	};
	addEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
	removeEventListener?: (type: string, listener: EventListenerOrEventListenerObject) => void;
};

type BluetoothRemoteGATTServerLike = {
	getPrimaryService: (
		service: BluetoothServiceIdentifier
	) => Promise<BluetoothRemoteGATTServiceLike>;
};

type BluetoothRemoteGATTServiceLike = {
	getCharacteristic: (
		characteristic: BluetoothCharacteristicIdentifier
	) => Promise<BluetoothCharacteristicWithRead>;
};

type BluetoothCharacteristicWithNotifications = EventTarget & {
	addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
	removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => void;
	startNotifications: () => Promise<void>;
	stopNotifications: () => Promise<void>;
};

type BluetoothCharacteristicWithRead = BluetoothCharacteristicWithNotifications & {
	readValue: () => Promise<DataView>;
};

type BluetoothServiceIdentifier = number | string;
type BluetoothCharacteristicIdentifier = number | string;
