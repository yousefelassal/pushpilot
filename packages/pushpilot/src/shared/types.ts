export type Json =
	| string
	| number
	| boolean
	| null
	| readonly Json[]
	| { readonly [key: string]: Json };

export interface VapidKeyPair {
	readonly publicKey: string | undefined;
	readonly privateKey: string | undefined;
}

export interface VapidConfig extends VapidKeyPair {
	readonly subject: string | undefined;
	readonly previous?: readonly VapidKeyPair[];
}

export interface PushConfig {
	readonly vapid: VapidConfig;
	// Additional hosts, or an explicit opt-out for trusted egress environments.
	readonly allowPushHosts?: readonly string[] | 'any';
	readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}

export interface PushSubscriptionRecord {
	readonly endpoint: string;
	readonly p256dh: string;
	readonly auth: string;
	readonly keyId: string;
}

export interface NotificationContent {
	readonly title: string;
	readonly body?: string;
	readonly url?: string;
	readonly icon?: string;
	readonly badge?: string;
	readonly image?: string;
	readonly requireInteraction?: boolean;
	readonly silent?: boolean;
	readonly actions?: readonly {
		readonly action: string;
		readonly title: string;
		readonly url?: string;
	}[];
	readonly data?: { readonly [key: string]: Json };
}

export type PushNotification = NotificationContent &
	(
		| { readonly tag?: undefined; readonly renotify?: false }
		| { readonly tag: string; readonly renotify?: boolean }
	);

export interface SendOptions {
	readonly ttl?: number; // Integer 1..2419200, default 86400 seconds.
	readonly urgency?: 'very-low' | 'low' | 'normal' | 'high'; // Default normal.
}

export type RetryableReason = 'rate-limited' | 'server-error' | 'network';
export type PermanentReason =
	| 'invalid-subscription'
	| 'configuration'
	| 'not-attempted'
	| 'bad-request'
	| 'payload-too-large'
	| 'redirect'
	| 'unexpected';

export interface ResultBase {
	readonly index: number;
	readonly endpointHash: string;
	readonly attempts: 0 | 1 | 2;
	readonly needsResubscribe: boolean;
}

export type DeliveryResult = ResultBase &
	(
		| { readonly status: 'accepted'; readonly httpStatus: number }
		| { readonly status: 'gone'; readonly httpStatus: 404 | 410 }
		| { readonly status: 'outdated'; readonly httpStatus: null }
		| ({
				readonly status: 'failed';
				readonly httpStatus: number | null;
		  } & (
				| { readonly reason: RetryableReason; readonly retryable: true }
				| { readonly reason: PermanentReason; readonly retryable: false }
		  ))
	);

export interface SendReport {
	readonly results: readonly DeliveryResult[];
}

export interface SubscribeEvent {
	readonly request: Request;
	readonly subscription: PushSubscriptionRecord;
	readonly previousEndpoint: string | null;
}

export interface UnsubscribeEvent {
	readonly request: Request;
	readonly endpoint: string;
}

export type CallbackResult = void | Response;
export interface PushCallbacks {
	onSubscribe(event: SubscribeEvent): CallbackResult | Promise<CallbackResult>;
	onUnsubscribe(
		event: UnsubscribeEvent,
	): CallbackResult | Promise<CallbackResult>;
}

export interface Push {
	send(
		subscriptions: readonly PushSubscriptionRecord[],
		notification: PushNotification,
		options?: SendOptions,
	): Promise<SendReport>;
	handler(callbacks: PushCallbacks): (request: Request) => Promise<Response>;
}

export type PushpilotErrorCode =
	| 'invalid-config'
	| 'invalid-notification'
	| 'payload-too-large';
export class PushpilotError extends Error {
	constructor(
		readonly code: PushpilotErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'PushpilotError';
	}
}
