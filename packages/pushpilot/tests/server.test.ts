import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPush } from '../src/server/index.js';
import { fixture, pair } from './server-fixtures.js';
import { keyId } from '../src/shared/keys.js';

let sample: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
	sample = await fixture();
});
afterEach(() => {
	vi.useRealTimers();
});

describe('sender', () => {
	it.each([
		[201, 'accepted', undefined],
		[202, 'accepted', undefined],
		[204, 'accepted', undefined],
		[404, 'gone', undefined],
		[410, 'gone', undefined],
		[401, 'failed', 'configuration'],
		[403, 'failed', 'configuration'],
		[400, 'failed', 'bad-request'],
		[413, 'failed', 'payload-too-large'],
		[302, 'failed', 'redirect'],
		[418, 'failed', 'unexpected'],
	])(
		'classifies HTTP %s without exposing secrets',
		async (status, outcome, reason) => {
			let captured: RequestInit | undefined;
			let cancelled = false;
			const push = createPush({
				vapid: sample.vapid,
				fetch: async (_, init) => {
					captured = init;
					return new Response(
						status === 204
							? null
							: new ReadableStream({
									cancel() {
										cancelled = true;
									},
								}),
						{ status },
					);
				},
			});
			const result = await push.send([sample.subscription], { title: 'Hello' });
			expect(result.results[0]).toMatchObject({
				index: 0,
				status: outcome,
				httpStatus: status,
				attempts: 1,
				needsResubscribe: false,
			});
			if (reason)
				expect(result.results[0]).toMatchObject({ reason, retryable: false });
			expect(captured?.redirect).toBe('manual');
			expect(new Headers(captured?.headers).get('ttl')).toBe('86400');
			expect(new Headers(captured?.headers).get('authorization')).toMatch(
				/^vapid t=/,
			);
			if (status !== 204) expect(cancelled).toBe(true);
			expect(JSON.stringify(result)).not.toContain(
				sample.subscription.endpoint,
			);
			expect(JSON.stringify(result)).not.toContain(sample.subscription.auth);
		},
	);

	it.each([429, 500, 503, 599])(
		'retries HTTP %s exactly once and classifies the final response',
		async (status) => {
			let count = 0;
			const push = createPush({
				vapid: sample.vapid,
				fetch: async () => {
					count++;
					return new Response(null, {
						status: count === 1 ? status : 410,
						headers: { 'retry-after': '0' },
					});
				},
			});
			const report = await push.send([sample.subscription], { title: 'Hello' });
			expect(count).toBe(2);
			expect(report.results[0]).toMatchObject({
				status: 'gone',
				httpStatus: 410,
				attempts: 2,
			});
		},
	);

	it('reports retry exhaustion as temporary and never returns raw provider text', async () => {
		const fetcher = vi.fn(
			async () =>
				new Response('sentinel-secret', {
					status: 429,
					headers: { 'retry-after': '0' },
				}),
		);
		const push = createPush({ vapid: sample.vapid, fetch: fetcher });
		const report = await push.send([sample.subscription], { title: 'Hello' });
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect(report.results[0]).toMatchObject({
			reason: 'rate-limited',
			retryable: true,
			attempts: 2,
		});
		expect(JSON.stringify(report)).not.toContain('sentinel-secret');
	});

	it('retries a network exception and removes exception details', async () => {
		let calls = 0;
		const push = createPush({
			vapid: sample.vapid,
			fetch: async () => {
				calls++;
				if (calls === 1) throw new Error(sample.subscription.endpoint);
				return new Response(null, { status: 201 });
			},
		});
		expect(
			(await push.send([sample.subscription], { title: 'Hello' })).results[0],
		).toMatchObject({ status: 'accepted', attempts: 2 });
	});

	it('holds no more than six slots and preserves input indexes', async () => {
		let active = 0;
		let maximum = 0;
		const push = createPush({
			vapid: sample.vapid,
			fetch: async () => {
				active++;
				maximum = Math.max(maximum, active);
				await new Promise((resolve) => setTimeout(resolve, 10));
				active--;
				return new Response(null, { status: 201 });
			},
		});
		const rows = Array.from({ length: 15 }, (_, index) => ({
			...sample.subscription,
			endpoint: `${sample.subscription.endpoint}/${index}`,
		}));
		const report = await push.send(rows, { title: 'Hello' });
		expect(maximum).toBeLessThanOrEqual(6);
		expect(maximum).toBeGreaterThan(1);
		expect(report.results.map((result) => result.index)).toEqual(
			rows.map((_, index) => index),
		);
	});

	it('stops queued work only in the rejected origin and key group', async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 403 }));
		const push = createPush({ vapid: sample.vapid, fetch: fetcher });
		const rows = Array.from({ length: 20 }, (_, index) => ({
			...sample.subscription,
			endpoint: `${sample.subscription.endpoint}/${index}`,
		}));
		const report = await push.send(rows, { title: 'Hello' });
		expect(fetcher.mock.calls.length).toBeLessThanOrEqual(6);
		expect(
			report.results.filter(
				(result) =>
					result.status === 'failed' && result.reason === 'not-attempted',
			).length,
		).toBeGreaterThan(0);
		expect(
			report.results.every(
				(result) => result.status === 'failed' && !result.retryable,
			),
		).toBe(true);
	});

	it('continues delivery for another origin after a rejection', async () => {
		const push = createPush({
			vapid: sample.vapid,
			fetch: async (url) =>
				new Response(null, { status: url.includes('mozilla') ? 201 : 403 }),
		});
		const rows = [
			...Array.from({ length: 12 }, (_, index) => ({
				...sample.subscription,
				endpoint: `${sample.subscription.endpoint}/${index}`,
			})),
			{
				...sample.subscription,
				endpoint: 'https://updates.push.services.mozilla.com/a',
			},
		];
		const report = await push.send(rows, { title: 'Hello' });
		expect(report.results.at(-1)).toMatchObject({ status: 'accepted' });
	});

	it('signs retained old subscriptions with the matching key and skips unknown keys', async () => {
		const current = await pair();
		const fetcher = vi.fn(async (_url: string, init: RequestInit) => {
			expect(new Headers(init.headers).get('authorization')).toContain(
				`k=${sample.vapid.publicKey}`,
			);
			return new Response(null, { status: 201 });
		});
		const push = createPush({
			vapid: {
				...current,
				subject: sample.vapid.subject,
				previous: [sample.vapid],
			},
			fetch: fetcher,
		});
		const report = await push.send(
			[
				sample.subscription,
				{ ...sample.subscription, keyId: '0000000000000000' },
			],
			{ title: 'Hello' },
		);
		expect(report.results[0]).toMatchObject({
			status: 'accepted',
			needsResubscribe: true,
		});
		expect(report.results[1]).toMatchObject({
			status: 'outdated',
			needsResubscribe: true,
			attempts: 0,
		});
		expect(fetcher).toHaveBeenCalledTimes(1);
	});

	it('returns invalid rows as failures without fetching or pruning', async () => {
		const fetcher = vi.fn(async () => new Response(null, { status: 201 }));
		const push = createPush({ vapid: sample.vapid, fetch: fetcher });
		const rows = [
			{ ...sample.subscription, endpoint: 'https://evil.example/a' },
			{ ...sample.subscription, p256dh: 'bad' },
			{ ...sample.subscription, keyId: 'invalid' },
		];
		const report = await push.send(rows, { title: 'Hello' });
		expect(
			report.results.every(
				(result) =>
					result.status === 'failed' &&
					result.reason === 'invalid-subscription' &&
					result.attempts === 0,
			),
		).toBe(true);
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('bounds attempts even when a custom fetch ignores AbortSignal', async () => {
		vi.useFakeTimers();
		let started: (() => void) | undefined;
		const beginning = new Promise<void>((resolve) => {
			started = resolve;
		});
		const fetcher = vi.fn(() => {
			started?.();
			return new Promise<Response>(() => {});
		});
		const push = createPush({ vapid: sample.vapid, fetch: fetcher });
		const sending = push.send([sample.subscription], { title: 'Hello' });
		await beginning;
		await vi.advanceTimersByTimeAsync(10500);
		expect(fetcher).toHaveBeenCalledTimes(2);
		await vi.advanceTimersByTimeAsync(10000);
		expect((await sending).results[0]).toMatchObject({
			status: 'failed',
			reason: 'network',
			attempts: 2,
			retryable: true,
		});
	});

	it('caps Retry-After dates at two seconds', async () => {
		vi.useFakeTimers();
		let started: (() => void) | undefined;
		const beginning = new Promise<void>((resolve) => {
			started = resolve;
		});
		const fetcher = vi.fn(async () => {
			started?.();
			return new Response(null, {
				status: fetcher.mock.calls.length === 1 ? 429 : 201,
				headers: { 'retry-after': new Date(Date.now() + 600000).toUTCString() },
			});
		});
		const push = createPush({ vapid: sample.vapid, fetch: fetcher });
		const sending = push.send([sample.subscription], { title: 'Hello' });
		await beginning;
		await vi.advanceTimersByTimeAsync(1999);
		expect(fetcher).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect((await sending).results[0]).toMatchObject({
			status: 'accepted',
			attempts: 2,
		});
	});

	it('bounds response-body cancellation within the attempt deadline', async () => {
		vi.useFakeTimers();
		let started: (() => void) | undefined;
		const beginning = new Promise<void>((resolve) => {
			started = resolve;
		});
		let calls = 0;
		const push = createPush({
			vapid: sample.vapid,
			fetch: async () => {
				calls++;
				return new Response(
					new ReadableStream({
						cancel() {
							started?.();
							return new Promise<void>(() => {});
						},
					}),
					{ status: 201 },
				);
			},
		});
		const sending = push.send([sample.subscription], { title: 'Hello' });
		await beginning;
		await vi.advanceTimersByTimeAsync(20500);
		expect(calls).toBe(2);
		expect((await sending).results[0]).toMatchObject({
			reason: 'network',
			attempts: 2,
		});
	});

	it('validates configuration before I/O and supports a valid empty batch', async () => {
		expect(() =>
			createPush({ vapid: { ...sample.vapid, privateKey: 'bad' } }),
		).toThrow(/privateKey/);
		const fetcher = vi.fn(async () => new Response(null, { status: 201 }));
		const wrong = await pair();
		const push = createPush({
			vapid: { ...sample.vapid, privateKey: wrong.privateKey },
			fetch: fetcher,
		});
		await expect(
			push.send([sample.subscription], { title: 'Hello' }),
		).rejects.toMatchObject({ code: 'invalid-config' });
		expect(fetcher).not.toHaveBeenCalled();
		expect(
			await createPush({ vapid: sample.vapid }).send([], { title: 'Hello' }),
		).toEqual({ results: [] });
		expect(await keyId(sample.vapid.publicKey)).toBe(sample.subscription.keyId);
	});
});

it('preserves a received temporary error when another request blocks the retry', async () => {
	vi.useFakeTimers();
	let calls = 0;
	let bothStarted: (() => void) | undefined;
	const beginning = new Promise<void>((resolve) => {
		bothStarted = resolve;
	});
	const push = createPush({
		vapid: sample.vapid,
		fetch: async () => {
			calls++;
			if (calls === 2) bothStarted?.();
			return new Response(null, { status: calls === 1 ? 503 : 403 });
		},
	});
	const sending = push.send(
		[
			sample.subscription,
			{ ...sample.subscription, endpoint: 'https://fcm.googleapis.com/second' },
		],
		{ title: 'Hello' },
	);
	await beginning;
	await vi.advanceTimersByTimeAsync(500);
	const results = (await sending).results;
	expect(
		results.filter(
			(result) =>
				result.status === 'failed' && result.reason === 'server-error',
		),
	).toEqual([
		expect.objectContaining({ attempts: 1, httpStatus: 503, retryable: true }),
	]);
	expect(calls).toBe(2);
});
