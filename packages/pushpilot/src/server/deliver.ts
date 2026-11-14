import { encryptNotification, vapidHeaders } from '@block65/webcrypto-web-push';
import { parseSubscription } from '../shared/subscription.js';
import type {
	DeliveryResult,
	PermanentReason,
	PushSubscriptionRecord,
	ResultBase,
	RetryableReason,
	SendReport,
} from '../shared/types/index.js';
import type {
	Attempt,
	BatchState,
	DeliveryInput,
	Recipient,
} from './types/delivery.js';

const MAX_CONCURRENCY = 6;
const ATTEMPT_DEADLINE_MS = 10_000;
const MAX_RETRY_DELAY_MS = 2000;

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

/** Honors Retry-After (seconds or HTTP date) but never waits longer than two seconds. */
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
		? Math.max(0, Math.min(MAX_RETRY_DELAY_MS, milliseconds))
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

/** Bounds fetch and body cleanup together, even when an injected fetch ignores AbortSignal. */
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
		}, ATTEMPT_DEADLINE_MS);
	});

	try {
		const pending = Promise.resolve().then(() =>
			fetcher(endpoint, { ...init, signal: controller.signal }),
		);
		// A custom fetch may resolve after the race timed out; its body still needs cancellation.
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

/**
 * Validates a stored record and finds its signing key. Returns a final
 * result instead of a recipient when the record cannot be sent to.
 */
async function resolveRecipient(
	state: BatchState,
	index: number,
	candidate: PushSubscriptionRecord,
): Promise<{ recipient: Recipient } | { result: DeliveryResult }> {
	const { input, blocked } = state;
	const [endpointHash, parsed] = await Promise.allSettled([
		hashEndpoint(candidate?.endpoint),
		parseSubscription(candidate, input.matchHost),
	]);
	if (endpointHash.status === 'rejected') throw endpointHash.reason;

	const base: ResultBase = {
		index,
		endpointHash: endpointHash.value,
		attempts: 0,
		needsResubscribe: false,
	};
	if (parsed.status === 'rejected')
		return { result: failure(base, null, 'invalid-subscription') };

	const subscription = parsed.value;

	const known = {
		...base,
		needsResubscribe: subscription.keyId !== input.keys.current.keyId,
	};
	const key = input.keys.byId.get(subscription.keyId);
	if (!key)
		return { result: { ...known, status: 'outdated', httpStatus: null } };

	// VAPID audience and signing key jointly determine which requests share a config failure.
	const group = `${new URL(subscription.endpoint).origin}|${key.keyId}`;
	if (blocked.has(group))
		return { result: failure(known, null, 'not-attempted') };

	return { recipient: { subscription, key, base: known, group } };
}

function toWireSubscription({ subscription }: Recipient) {
	return {
		endpoint: subscription.endpoint,
		expirationTime: null,
		keys: { p256dh: subscription.p256dh, auth: subscription.auth },
	};
}

/** Signs once per group and shares the pending promise between concurrent recipients. */
async function authorizationFor(
	state: BatchState,
	recipient: Recipient,
): Promise<string> {
	let headers = state.headersByGroup.get(recipient.group);
	if (!headers) {
		headers = vapidHeaders(toWireSubscription(recipient), recipient.key);
		state.headersByGroup.set(recipient.group, headers);
	}
	return (await headers).headers.authorization;
}

function buildRequest(
	input: DeliveryInput,
	body: Uint8Array<ArrayBuffer>,
	authorization: string,
): RequestInit {
	return {
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
	};
}

/** Makes at most two requests, retrying once for retryable failures. */
async function sendWithRetry(
	state: BatchState,
	recipient: Recipient,
	request: RequestInit,
): Promise<DeliveryResult> {
	const { input, blocked } = state;
	const { subscription, group } = recipient;
	let base = recipient.base;

	// A concurrent rejection can suppress a retry, but must not erase an earlier response.
	let lastOutcome: DeliveryResult | undefined;
	for (const attempts of [1, 2] as const) {
		if (blocked.has(group))
			return lastOutcome ?? failure(base, null, 'not-attempted');

		base = { ...base, attempts };
		const result = await attempt(input.fetcher, subscription.endpoint, request);
		if (result.status === 401 || result.status === 403) blocked.add(group);

		const outcome = classify(base, result.status);
		lastOutcome = outcome;

		const shouldRetry =
			attempts === 1 && outcome.status === 'failed' && outcome.retryable;
		if (!shouldRetry) return outcome;
		await new Promise((resolve) => setTimeout(resolve, retryDelay(result)));
	}
	return failure(base, null, 'unexpected');
}

async function sendOne(
	state: BatchState,
	index: number,
	candidate: PushSubscriptionRecord,
): Promise<DeliveryResult> {
	const resolved = await resolveRecipient(state, index, candidate);
	if ('result' in resolved) return resolved.result;
	const { recipient } = resolved;

	const [body, authorization] = await Promise.allSettled([
		encryptNotification(toWireSubscription(recipient), state.input.payload),
		authorizationFor(state, recipient),
	]);

	if (body.status === 'rejected')
		// Bad browser keys are not a VAPID problem, so resubscribing under a new key would not help.
		return failure(
			{ ...recipient.base, needsResubscribe: false },
			null,
			'invalid-subscription',
		);

	if (authorization.status === 'rejected') {
		state.blocked.add(recipient.group);
		return failure(recipient.base, null, 'configuration');
	}

	return sendWithRetry(
		state,
		recipient,
		buildRequest(state.input, body.value, authorization.value),
	);
}

/** Returns one outcome per input index, with six slots covering encryption, I/O, and retries. */
export async function deliver(input: DeliveryInput): Promise<SendReport> {
	const results: DeliveryResult[] = [];
	const state: BatchState = {
		input,
		blocked: new Set(),
		headersByGroup: new Map(),
	};
	let cursor = 0;

	async function worker(): Promise<void> {
		while (cursor < input.subscriptions.length) {
			const index = cursor++;
			const subscription = input.subscriptions[index];
			results[index] =
				subscription === undefined
					? failure(
							{ index, endpointHash: '', attempts: 0, needsResubscribe: false },
							null,
							'invalid-subscription',
						)
					: await sendOne(state, index, subscription);
		}
	}

	await Promise.all(
		Array.from(
			{ length: Math.min(MAX_CONCURRENCY, input.subscriptions.length) },
			worker,
		),
	);
	return { results };
}
