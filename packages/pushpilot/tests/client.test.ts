import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPushClient } from '../src/client/index.js';
import { encodeBase64, keyId } from '../src/shared/keys.js';

let publicKey: string;
let currentKeyId: string;
let subscription: ReturnType<typeof makeSubscription> | null;
let requests: Array<Record<string, unknown>>;
let responseStatus: number;
let permission: NotificationPermission;
let requestPermission: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;
let registration: object;
let fetcher: ReturnType<typeof vi.fn>;
let visibilityListeners: Set<() => void>;

function makeSubscription(key = publicKey) {
	const endpoint = `https://fcm.googleapis.com/${Math.random()}`;
	return {
		endpoint,
		options: {
			applicationServerKey: Uint8Array.from(
				atob(key.replace(/-/g, '+').replace(/_/g, '/')),
				(char) => char.charCodeAt(0),
			).buffer,
		},
		toJSON: () => ({ endpoint, keys: { p256dh: publicKey, auth: 'test' } }),
		unsubscribe: vi.fn(async () => {
			subscription = null;
			return true;
		}),
	};
}

beforeEach(async () => {
	const keys = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify'],
	);
	publicKey = encodeBase64(
		new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)),
	);
	currentKeyId = await keyId(publicKey);
	subscription = null;
	requests = [];
	responseStatus = 204;
	permission = 'granted';
	visibilityListeners = new Set();
	requestPermission = vi.fn(async () => {
		permission = 'granted';
		return permission;
	});
	subscribe = vi.fn(async () => {
		subscription = makeSubscription();
		return subscription;
	});
	registration = {
		active: {},
		pushManager: { getSubscription: async () => subscription, subscribe },
	};
	const notification = {
		get permission() {
			return permission;
		},
		requestPermission,
	};
	vi.stubGlobal('Notification', notification);
	vi.stubGlobal('window', {
		isSecureContext: true,
		PushManager: {},
		Notification: notification,
		matchMedia: () => ({ matches: false }),
	});
	vi.stubGlobal('navigator', {
		userAgent: 'test',
		platform: 'Linux',
		maxTouchPoints: 0,
		serviceWorker: { getRegistration: vi.fn(async () => registration) },
	});
	vi.stubGlobal('document', {
		visibilityState: 'visible',
		addEventListener: (_: string, listener: () => void) =>
			visibilityListeners.add(listener),
		removeEventListener: (_: string, listener: () => void) =>
			visibilityListeners.delete(listener),
	});
	fetcher = vi.fn(async (_url: string, init: RequestInit) => {
		if (typeof init.body !== 'string')
			throw new Error('Expected a JSON string request body');
		const body: Record<string, unknown> = JSON.parse(init.body);
		requests.push(body);
		return body.action === 'config'
			? Response.json({ publicKey, keyId: currentKeyId })
			: new Response(null, { status: responseStatus });
	});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.useRealTimers();
});

async function started() {
	const client = createPushClient({ fetch: fetcher });
	const stop = client.start();
	await vi.waitFor(() =>
		expect(client.getSnapshot().status).not.toBe('unknown'),
	);
	return { client, stop };
}

describe('browser client', () => {
	it('constructs and returns a stable server snapshot without browser globals', () => {
		vi.stubGlobal('window', undefined);
		vi.stubGlobal('navigator', undefined);
		const client = createPushClient();
		expect(client.getSnapshot()).toEqual({ status: 'unknown' });
		expect(client.getServerSnapshot()).toBe(client.getServerSnapshot());
		expect(client.getServerSnapshot()).toEqual({ status: 'unknown' });
	});
	it('requests permission synchronously inside enable and shares repeated calls', async () => {
		permission = 'default';
		const { client, stop } = await started();
		const first = client.enable();
		expect(requestPermission).toHaveBeenCalledTimes(1);
		expect(client.enable()).toBe(first);
		expect(await first).toEqual({ status: 'subscribed' });
		expect(subscribe).toHaveBeenCalledWith(
			expect.objectContaining({ userVisibleOnly: true }),
		);
		stop();
	});
	it('does not prompt before config and registration are ready', async () => {
		permission = 'default';
		const client = createPushClient({ fetch: fetcher });
		expect(await client.enable()).toEqual({
			status: 'error',
			error: { code: 'not-ready' },
		});
		expect(requestPermission).not.toHaveBeenCalled();
	});
	it('resolves iPadOS installation before missing API support', async () => {
		vi.stubGlobal('navigator', {
			userAgent: 'Macintosh',
			platform: 'MacIntel',
			maxTouchPoints: 5,
		});
		const { client, stop } = await started();
		expect(client.getSnapshot()).toEqual({ status: 'needs-install' });
		expect(fetcher).not.toHaveBeenCalled();
		stop();
	});
	it('does not repost after remount and detaches without reattaching on visibility', async () => {
		subscription = makeSubscription();
		const { client, stop } = await started();
		expect(client.getSnapshot().status).toBe('subscribed');
		stop();
		const stopAgain = client.start();
		await vi.waitFor(() => expect(visibilityListeners.size).toBe(1));
		await client.detach();
		for (const listener of visibilityListeners) listener();
		await new Promise((resolve) => setTimeout(resolve, 10));
		expect(subscription).not.toBeNull();
		expect(
			requests.filter((request) => request.action === 'subscribe'),
		).toHaveLength(1);
		expect(client.getSnapshot()).toEqual({ status: 'unsubscribed' });
		await client.sync();
		expect(
			requests.filter((request) => request.action === 'subscribe'),
		).toHaveLength(2);
		stopAgain();
	});
	it('keeps the browser subscription when server deletion fails', async () => {
		subscription = makeSubscription();
		const original = subscription;
		const { client, stop } = await started();
		responseStatus = 401;
		expect(await client.disable()).toEqual({
			status: 'error',
			error: { code: 'server', status: 401 },
		});
		expect(original.unsubscribe).not.toHaveBeenCalled();
		stop();
	});
	it('removes the server row before browser unsubscribe', async () => {
		subscription = makeSubscription();
		const original = subscription;
		const { client, stop } = await started();
		original.unsubscribe.mockImplementation(async () => {
			expect(requests.at(-1)?.action).toBe('unsubscribe');
			subscription = null;
			return true;
		});
		expect(await client.disable()).toEqual({ status: 'unsubscribed' });
		stop();
	});
	it('replaces an unknown browser key and preserves previousEndpoint', async () => {
		subscription = makeSubscription();
		const oldEndpoint = subscription.endpoint;
		Object.assign(subscription.options, { applicationServerKey: null });
		const { client, stop } = await started();
		expect(client.getSnapshot().status).toBe('subscribed');
		expect(subscribe).toHaveBeenCalledTimes(1);
		expect(
			requests.find((request) => request.action === 'subscribe')
				?.previousEndpoint,
		).toBe(oldEndpoint);
		stop();
	});
	it('bounds a missing registration discovery to ten seconds', async () => {
		vi.useFakeTimers();
		vi.stubGlobal('navigator', {
			userAgent: 'test',
			platform: 'Linux',
			maxTouchPoints: 0,
			serviceWorker: { getRegistration: () => new Promise(() => {}) },
		});
		const client = createPushClient({ fetch: fetcher });
		const stop = client.start();
		await vi.advanceTimersByTimeAsync(10_000);
		expect(client.getSnapshot()).toEqual({
			status: 'error',
			error: { code: 'service-worker' },
		});
		stop();
	});
});

it('refreshes configuration once on a stale-key response and then stops', async () => {
	subscription = makeSubscription();
	responseStatus = 409;
	const { client, stop } = await started();
	expect(client.getSnapshot()).toEqual({
		status: 'error',
		error: { code: 'config' },
	});
	expect(
		requests.filter((request) => request.action === 'config'),
	).toHaveLength(2);
	expect(
		requests.filter((request) => request.action === 'subscribe'),
	).toHaveLength(2);
	stop();
});
it('keeps previousEndpoint for a replacement write retry', async () => {
	subscription = makeSubscription();
	const previousEndpoint = subscription.endpoint;
	Object.assign(subscription.options, { applicationServerKey: null });
	responseStatus = 503;
	const { client, stop } = await started();
	expect(client.getSnapshot().status).toBe('error');
	responseStatus = 204;
	expect(await client.sync()).toEqual({ status: 'subscribed' });
	const writes = requests.filter((request) => request.action === 'subscribe');
	expect(writes).toHaveLength(2);
	expect(
		writes.every((write) => write.previousEndpoint === previousEndpoint),
	).toBe(true);
	stop();
});
it('serializes a detach behind initialization and shares in-flight detach', async () => {
	subscription = makeSubscription();
	let release: (() => void) | undefined;
	const gate = new Promise<void>((resolve) => {
		release = resolve;
	});
	const gatedFetch = vi.fn(async (url: string, init: RequestInit) => {
		if (typeof init.body !== 'string')
			throw new Error('Expected a JSON string request body');
		const body: Record<string, unknown> = JSON.parse(init.body);
		if (body.action === 'subscribe') await gate;
		return fetcher(url, init);
	});
	const client = createPushClient({ fetch: gatedFetch });
	const stop = client.start();
	await vi.waitFor(() => expect(gatedFetch).toHaveBeenCalledTimes(2));
	const detach = client.detach();
	expect(client.detach()).toBe(detach);
	expect(requests.some((request) => request.action === 'unsubscribe')).toBe(
		false,
	);
	release?.();
	expect(await detach).toEqual({ status: 'unsubscribed' });
	expect(requests.map((request) => request.action)).toEqual([
		'config',
		'subscribe',
		'unsubscribe',
	]);
	stop();
});
it('cleans up only after the final start reference stops', async () => {
	const { client, stop } = await started();
	const second = client.start();
	stop();
	expect(visibilityListeners.size).toBe(1);
	second();
	expect(visibilityListeners.size).toBe(0);
	second();
	expect(visibilityListeners.size).toBe(0);
});
it('rejects old iOS versions before installation guidance', async () => {
	vi.stubGlobal('navigator', {
		userAgent: 'iPhone OS 16_3 like Mac OS X',
		platform: 'iPhone',
		maxTouchPoints: 5,
	});
	const { client, stop } = await started();
	expect(client.getSnapshot()).toEqual({
		status: 'unsupported',
		reason: 'ios-version',
	});
	stop();
});

it('does not reattach after server deletion when browser unsubscribe fails', async () => {
	subscription = makeSubscription();
	subscription.unsubscribe.mockResolvedValue(false);
	const { client, stop } = await started();
	expect(await client.disable()).toMatchObject({ status: 'error' });
	const beforeFocus = requests.length;
	for (const listener of visibilityListeners) listener();
	await vi.waitFor(() =>
		expect(client.getSnapshot()).toEqual({ status: 'unsubscribed' }),
	);
	expect(requests.length).toBe(beforeFocus);
	await client.sync();
	expect(
		requests.filter((request) => request.action === 'subscribe'),
	).toHaveLength(2);
	stop();
});

it('allows authenticated server cleanup after permission is revoked', async () => {
	subscription = makeSubscription();
	const { client, stop } = await started();
	permission = 'denied';
	expect(await client.detach()).toEqual({ status: 'unsubscribed' });
	expect(
		requests.filter((request) => request.action === 'unsubscribe'),
	).toHaveLength(1);
	stop();
});
