/** Minimal structural types for the service worker globals this package uses. Internal. */
export interface ExtendableEvent {
	waitUntil(promise: Promise<unknown>): void;
}

export interface WorkerPushEvent extends ExtendableEvent {
	data: { text(): string } | null;
}

export interface WorkerClickEvent extends ExtendableEvent {
	action: string;
	notification: { close(): void; data: unknown };
}

export interface WorkerClient {
	url: string;
	focus(): Promise<unknown>;
}

export interface WorkerScope {
	location: { origin: string };
	registration: {
		scope: string;
		showNotification(
			title: string,
			options: NotificationOptions,
		): Promise<void>;
	};
	clients: {
		matchAll(options: {
			type: 'window';
			includeUncontrolled: boolean;
		}): Promise<readonly WorkerClient[]>;
		openWindow(url: string): Promise<unknown>;
	};
	addEventListener(
		type: 'push',
		listener: (event: WorkerPushEvent) => void,
	): void;
	addEventListener(
		type: 'notificationclick',
		listener: (event: WorkerClickEvent) => void,
	): void;
}

/** Click targets stored in `notification.data`. */
export interface NavigationData {
	url?: string;
	actions?: ReadonlyArray<{ action: string; url?: string }>;
	data?: unknown;
}

/** `NotificationOptions` plus fields the DOM lib omits. */
export interface DisplayOptions extends NotificationOptions {
	image?: string;
	actions?: ReadonlyArray<{ action: string; title: string }>;
}
