import { encryptNotification, vapidHeaders } from '@block65/webcrypto-web-push';
import type { PreparedKey, prepareKeys } from '../shared/keys.js';
import { parseSubscription } from '../shared/subscription.js';
import type {
	DeliveryResult,
	PermanentReason,
	PushSubscriptionRecord,
	ResultBase,
	RetryableReason,
	SendReport,
} from '../shared/types.js';

interface DeliveryInput {
	subscriptions: readonly PushSubscriptionRecord[];
	payload: Uint8Array<ArrayBuffer>;
	ttl: number;
	urgency: string;
	keys: Awaited<ReturnType<typeof prepareKeys>>;
	matchHost: (host: string) => boolean;
	fetcher: (url: string, init: RequestInit) => Promise<Response>;
}

type Attempt =
	| { status: number; retryAfter: string | null }
	| { status: null; retryAfter: null };

function failure(
	base: ResultBase,
	httpStatus: number | null,
	reason: RetryableReason | PermanentReason,
): DeliveryResult {
	if (
		reason === 'rate-limited' ||
		reason === 'server-error' ||
		reason === 'network'
	) {
		return { ...base, status: 'failed', httpStatus, reason, retryable: true };
	}
	return { ...base, status: 'failed', httpStatus, reason, retryable: false };
}

function classify(base: ResultBase, status: number | null): DeliveryResult {
	if (status === null) return failure(base, null, 'network');
	if (status >= 200 && status < 300)
		return { ...base, status: 'accepted', httpStatus: status };
	if (status === 404 || status === 410)
		return { ...base, status: 'gone', httpStatus: status };
	if (status === 401 || status === 403)
		return failure(base, status, 'configuration');
	if (status === 400) return failure(base, status, 'bad-request');
	if (status === 413) return failure(base, status, 'payload-too-large');
	if (status === 429) return failure(base, status, 'rate-limited');
	if (status >= 500 && status <= 599)
		return failure(base, status, 'server-error');
	if (status >= 300 && status <= 399) return failure(base, status, 'redirect');
	return failure(base, status, 'unexpected');
}

function retryDelay(result: Attempt): number {
	const fallback = result.status === 429 ? 1000 : 500;
	if (result.retryAfter === null) return fallback;
	const seconds = /^\d+$/.test(result.retryAfter.trim())
		? Number(result.retryAfter)
		: NaN;
	const milliseconds = Number.isFinite(seconds)
		? seconds * 1000
		: Date.parse(result.retryAfter) - Date.now();
	return Number.isFinite(milliseconds)
		? Math.max(0, Math.min(2000, milliseconds))
		: fallback;
}

async function hashEndpoint(endpoint: unknown): Promise<string> {
	if (typeof endpoint !== 'string') return '';
	const hash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint)),
	);
	return Array.from(hash.slice(0, 8), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}

async function attempt(
	fetcher: DeliveryInput['fetcher'],
	endpoint: string,
	init: RequestInit,
): Promise<Attempt> {
	const controller = new AbortController();
	let expired = false;
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const deadline = new Promise<never>((_, reject) => {
		timeout = setTimeout(() => {
			expired = true;
			controller.abort();
			reject(new Error('Delivery deadline exceeded.'));
		}, 10000);
	});
	try {
		const pending = Promise.resolve().then(() =>
			fetcher(endpoint, { ...init, signal: controller.signal }),
		);
		void pending.then(
			(response) => {
				if (expired) void response.body?.cancel().catch(() => {});
			},
			() => {},
		);
		const response = await Promise.race([pending, deadline]);
		const result = {
			status: response.status,
			retryAfter: response.headers.get('retry-after'),
		};
		if (response.body) {
			await Promise.race([response.body.cancel().catch(() => {}), deadline]);
		}
		return result;
	} catch {
		return { status: null, retryAfter: null };
	} finally {
		clearTimeout(timeout);
	}
}

export async function deliver(input: DeliveryInput): Promise<SendReport> {
	const results: DeliveryResult[] = [];
	const blocked = new Set<string>();
	const headersByGroup = new Map<
		string,
		Promise<{ headers: { authorization: string } }>
	>();
	let cursor = 0;

	async function sendOne(
		index: number,
		candidate: PushSubscriptionRecord,
	): Promise<DeliveryResult> {
		const endpointHash = await hashEndpoint(candidate?.endpoint);
		let base: ResultBase = {
			index,
			endpointHash,
			attempts: 0,
			needsResubscribe: false,
		};
		let subscription: PushSubscriptionRecord;
		try {
			subscription = await parseSubscription(candidate, input.matchHost);
		} catch {
			return failure(base, null, 'invalid-subscription');
		}
		base = {
			...base,
			needsResubscribe: subscription.keyId !== input.keys.current.keyId,
		};
		const key = input.keys.byId.get(subscription.keyId);
		if (!key) return { ...base, status: 'outdated', httpStatus: null };
		const group = `${new URL(subscription.endpoint).origin}|${key.keyId}`;
		if (blocked.has(group)) return failure(base, null, 'not-attempted');
		const wireSubscription = {
			endpoint: subscription.endpoint,
			expirationTime: null,
			keys: { p256dh: subscription.p256dh, auth: subscription.auth },
		};
		let body: Uint8Array<ArrayBuffer>;
		try {
			body = await encryptNotification(wireSubscription, input.payload);
		} catch {
			return failure(
				{ ...base, needsResubscribe: false },
				null,
				'invalid-subscription',
			);
		}
		let authorization: string;
		try {
			let headers = headersByGroup.get(group);
			if (!headers) {
				headers = vapidHeaders(wireSubscription, key satisfies PreparedKey);
				headersByGroup.set(group, headers);
			}
			authorization = (await headers).headers.authorization;
		} catch {
			blocked.add(group);
			return failure(base, null, 'configuration');
		}
		let lastOutcome: DeliveryResult | undefined;
		for (const attempts of [1, 2] as const) {
			if (blocked.has(group))
				return lastOutcome ?? failure(base, null, 'not-attempted');
			base = { ...base, attempts };
			const result = await attempt(input.fetcher, subscription.endpoint, {
				method: 'POST',
				redirect: 'manual',
				body,
				headers: {
					authorization,
					'content-type': 'application/octet-stream',
					'content-encoding': 'aes128gcm',
					TTL: String(input.ttl),
					Urgency: input.urgency,
				},
			});
			if (result.status === 401 || result.status === 403) blocked.add(group);
			const outcome = classify(base, result.status);
			lastOutcome = outcome;
			if (attempts === 1 && outcome.status === 'failed' && outcome.retryable) {
				await new Promise((resolve) => setTimeout(resolve, retryDelay(result)));
				continue;
			}
			return outcome;
		}
		return failure(base, null, 'unexpected');
	}

	async function worker(): Promise<void> {
		while (cursor < input.subscriptions.length) {
			const index = cursor++;
			const subscription = input.subscriptions[index];
			if (subscription === undefined) {
				results[index] = failure(
					{ index, endpointHash: '', attempts: 0, needsResubscribe: false },
					null,
					'invalid-subscription',
				);
			} else {
				results[index] = await sendOne(index, subscription);
			}
		}
	}
	await Promise.all(
		Array.from({ length: Math.min(6, input.subscriptions.length) }, worker),
	);
	return { results };
}
