export type LiveEcgReading = {
	heartRate: number;
	rrMs: number;
	receivedAtMs: number;
};

const CHANNEL_NAME = 'sanctuary-live-ecg';
const EVENT_NAME = 'sanctuary-live-ecg';

let channel: BroadcastChannel | null = null;

function getChannel(): BroadcastChannel | null {
	if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') {
		return null;
	}

	if (!channel) {
		channel = new BroadcastChannel(CHANNEL_NAME);
	}

	return channel;
}

export function publishLiveEcgReading(reading: LiveEcgReading) {
	if (typeof window === 'undefined') {
		return;
	}

	window.dispatchEvent(new CustomEvent<LiveEcgReading>(EVENT_NAME, { detail: reading }));
	getChannel()?.postMessage(reading);
}

export function subscribeLiveEcgReadings(
	onReading: (reading: LiveEcgReading) => void
): () => void {
	if (typeof window === 'undefined') {
		return () => {};
	}

	const handleWindowEvent = (event: Event) => {
		const customEvent = event as CustomEvent<LiveEcgReading>;
		if (customEvent.detail) {
			onReading(customEvent.detail);
		}
	};

	const activeChannel = getChannel();
	const handleChannelMessage = (event: MessageEvent<LiveEcgReading>) => {
		if (event.data) {
			onReading(event.data);
		}
	};

	window.addEventListener(EVENT_NAME, handleWindowEvent as EventListener);
	activeChannel?.addEventListener('message', handleChannelMessage);

	return () => {
		window.removeEventListener(EVENT_NAME, handleWindowEvent as EventListener);
		activeChannel?.removeEventListener('message', handleChannelMessage);
	};
}
