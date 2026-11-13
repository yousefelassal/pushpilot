import { describe, expect, it } from 'vitest';
import { encodePayload, parseNotification } from '../src/shared/wire.js';
import {
	createHostMatcher,
	parseSubscription,
	parseEndpoint,
} from '../src/shared/subscription.js';
import {
	normalizeKey,
	prepareKeys,
	keyId,
	decodeBase64,
	encodeBase64,
} from '../src/shared/keys.js';
import { vapid, subscription } from './fixtures.js';

describe('wire boundaries', () => {
	it('measures the complete UTF-8 envelope at exactly 3993 bytes', () => {
		const overhead = encodePayload({ title: 'x', body: '' }).payload.length;
		expect(
			encodePayload({ title: 'x', body: 'x'.repeat(3993 - overhead) }).payload,
		).toHaveLength(3993);
		expect(() =>
			encodePayload({ title: 'x', body: 'x'.repeat(3994 - overhead) }),
		).toThrow('3993');
		expect(() => encodePayload({ title: 'x', body: 'é'.repeat(2000) })).toThrow(
			'3993',
		);
	});
	it.each([0, -1, 1.5, NaN, Infinity, 2419201])(
		'rejects invalid TTL %s',
		(ttl) => expect(() => encodePayload({ title: 'x' }, { ttl })).toThrow(),
	);
	it('rejects unsupported JSON and unsafe options', () => {
		for (const data of [
			{ value: NaN },
			{ value: undefined },
			{ value: 1n },
			{ value: new Date() },
		])
			expect(() => parseNotification({ title: 'x', data })).toThrow();
		const cycle: Record<string, unknown> = {};
		cycle.self = cycle;
		expect(() => parseNotification({ title: 'x', data: cycle })).toThrow();
		expect(() => parseNotification({ title: 'x', renotify: true })).toThrow();
		expect(() =>
			parseNotification({ title: 'x', url: 'javascript:alert(1)' }),
		).toThrow();
	});
	it('owns its wire version and removes extra fields', () => {
		const notification = { title: 'x', v: 42, endpoint: 'secret' };
		const bytes = encodePayload(notification).payload;
		expect(JSON.parse(new TextDecoder().decode(bytes))).toEqual({
			v: 1,
			title: 'x',
		});
	});
});

describe('subscription boundaries', () => {
	it.each([
		'http://fcm.googleapis.com/send/x',
		'https://127.0.0.1/x',
		'https://[::1]/x',
		'https://localhost/x',
		'https://fcm.googleapis.com:444/x',
		'https://user:pass@fcm.googleapis.com/x',
		'https://fcm.googleapis.com/x#secret',
	])('rejects unsafe URL %s', (url) =>
		expect(() => parseEndpoint(url)).toThrow(),
	);
	it('matches proper suffix boundaries', () => {
		const matches = createHostMatcher();
		expect(matches('web.push.apple.com')).toBe(true);
		expect(matches('push.apple.com')).toBe(false);
		expect(matches('web.push.apple.com.attacker.test')).toBe(false);
		expect(matches('evilpush.apple.com')).toBe(false);
		expect(() => createHostMatcher(['https://example.com'])).toThrow();
	});
	it('imports actual P-256 points and rejects corrupt rows', async () => {
		const key = await vapid();
		const record = await subscription(key.publicKey);
		await expect(
			parseSubscription(record, createHostMatcher()),
		).resolves.toEqual(record);
		await expect(
			parseSubscription({ ...record, auth: 'not-a-key' }, createHostMatcher()),
		).rejects.toThrow();
		await expect(
			parseSubscription(
				{ ...record, endpoint: 'https://attacker.example/x' },
				createHostMatcher(),
			),
		).rejects.toThrow();
		await expect(
			parseSubscription({ ...record, keyId: 'wrong' }, createHostMatcher()),
		).rejects.toThrow();
	});
});

describe('key ring', () => {
	it('verifies pair ownership and derives deterministic fingerprints', async () => {
		const first = await vapid();
		const second = await vapid();
		const ring = await prepareKeys({ ...first, previous: [second] });
		expect(ring.current.keyId).toBe(await keyId(first.publicKey));
		expect(ring.byId.size).toBe(2);
		await expect(
			prepareKeys({ ...first, privateKey: second.privateKey }),
		).rejects.toThrow('do not match');
		await expect(prepareKeys({ ...first, previous: [first] })).rejects.toThrow(
			'Duplicate',
		);
	});
	it('normalizes padding without exposing invalid input', () => {
		expect(encodeBase64(decodeBase64('AQ=='))).toBe('AQ');
		expect(() => normalizeKey('SECRET', 65, 'public key')).toThrow(
			'Invalid public key',
		);
	});
});
