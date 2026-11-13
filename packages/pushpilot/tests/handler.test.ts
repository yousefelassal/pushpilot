import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createPush } from '../src/server/index.js';
import { fixture, pair } from './server-fixtures.js';

let sample: Awaited<ReturnType<typeof fixture>>;
beforeAll(async () => {
	sample = await fixture();
});
const request = (body: unknown, init: RequestInit = {}) =>
	new Request('https://app.example/api/push', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body),
		...init,
	});
const browserSubscription = () => ({
	endpoint: sample.subscription.endpoint,
	keys: { auth: sample.subscription.auth, p256dh: sample.subscription.p256dh },
});

describe('Request/Response handler', () => {
	it('returns only public configuration with no-store', async () => {
		const onSubscribe = vi.fn();
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe,
			onUnsubscribe() {},
		});
		const response = await handler(request({ action: 'config' }));
		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			publicKey: sample.vapid.publicKey,
			keyId: sample.subscription.keyId,
		});
		expect(onSubscribe).not.toHaveBeenCalled();
	});

	it('validates subscription, derives key identity, and waits for the callback', async () => {
		const onSubscribe = vi.fn(async (event) => {
			expect(event.request.bodyUsed).toBe(true);
			expect(event.subscription).toEqual(sample.subscription);
			expect(event.previousEndpoint).toBe('https://retired.example/old');
		});
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe,
			onUnsubscribe() {},
		});
		const response = await handler(
			request({
				action: 'subscribe',
				subscription: browserSubscription(),
				publicKey: sample.vapid.publicKey,
				previousEndpoint: 'https://retired.example/old',
			}),
		);
		expect(response.status).toBe(204);
		expect(onSubscribe).toHaveBeenCalledTimes(1);
	});

	it('returns stale-key before invoking subscription callbacks', async () => {
		const onSubscribe = vi.fn();
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe,
			onUnsubscribe() {},
		});
		const response = await handler(
			request({
				action: 'subscribe',
				subscription: browserSubscription(),
				publicKey: (await pair()).publicKey,
			}),
		);
		expect(response.status).toBe(409);
		expect(await response.json()).toMatchObject({
			error: { code: 'stale-key' },
		});
		expect(onSubscribe).not.toHaveBeenCalled();
	});

	it('accepts removal for retired hosts and passes application refusal unchanged', async () => {
		const refusal = new Response('Sign in', {
			status: 401,
			headers: { 'x-auth': 'required' },
		});
		const onUnsubscribe = vi.fn(() => refusal);
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe() {},
			onUnsubscribe,
		});
		const response = await handler(
			request({ action: 'unsubscribe', endpoint: 'https://retired.example/a' }),
		);
		expect(response).toBe(refusal);
		expect(onUnsubscribe).toHaveBeenCalledTimes(1);
	});

	it('propagates callback exceptions without copying them to a JSON body', async () => {
		const cause = new Error('database unavailable');
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe() {},
			onUnsubscribe() {
				throw cause;
			},
		});
		await expect(
			handler(
				request({
					action: 'unsubscribe',
					endpoint: sample.subscription.endpoint,
				}),
			),
		).rejects.toBe(cause);
	});

	it('rejects callback success Responses as a programming error', async () => {
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe() {},
			onUnsubscribe() {
				return new Response(null);
			},
		});
		expect(
			(
				await handler(
					request({
						action: 'unsubscribe',
						endpoint: sample.subscription.endpoint,
					}),
				)
			).status,
		).toBe(500);
	});

	it('rejects cross-origin, wrong method, media type, malformed JSON, action, and fields', async () => {
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe() {},
			onUnsubscribe() {},
		});
		const cases = [
			[new Request('https://app.example/api/push'), 405],
			[
				request(
					{ action: 'config' },
					{
						headers: {
							'content-type': 'application/json',
							origin: 'https://evil.example',
						},
					},
				),
				403,
			],
			[
				request(
					{ action: 'config' },
					{ headers: { 'content-type': 'text/plain' } },
				),
				415,
			],
			[request({}, { body: '{' }), 400],
			[request({ action: 'send' }), 400],
			[request({ action: 'unsubscribe', endpoint: 'http://localhost/a' }), 400],
			[
				request({
					action: 'subscribe',
					publicKey: sample.vapid.publicKey,
					subscription: {
						endpoint: sample.subscription.endpoint,
						keys: { auth: 'bad', p256dh: 'bad' },
					},
				}),
				400,
			],
		] as const;
		for (const [req, status] of cases) {
			const response = await handler(req);
			expect(response.status).toBe(status);
			expect(response.headers.get('cache-control')).toBe('no-store');
		}
	});

	it('rejects consumed bodies and streamed oversized bodies without trusting Content-Length', async () => {
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe() {},
			onUnsubscribe() {},
		});
		const consumed = request({ action: 'config' });
		await consumed.text();
		expect((await handler(consumed)).status).toBe(400);
		const oversized = request(
			{ action: 'config', ignored: 'x'.repeat(17000) },
			{
				headers: { 'content-type': 'application/json', 'content-length': '2' },
			},
		);
		const response = await handler(oversized);
		expect(response.status).toBe(413);
	});

	it('does not echo endpoint values from malformed subscription input', async () => {
		const handler = createPush({ vapid: sample.vapid }).handler({
			onSubscribe() {},
			onUnsubscribe() {},
		});
		const response = await handler(
			request({
				action: 'subscribe',
				publicKey: sample.vapid.publicKey,
				subscription: { endpoint: 'https://evil.example/secret', keys: {} },
			}),
		);
		expect(await response.text()).not.toContain('secret');
	});
});
