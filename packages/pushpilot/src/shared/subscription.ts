import { decodeBase64, encodeBase64 } from './keys.js';
import { PushpilotError, type PushSubscriptionRecord } from './types.js';

const HOSTS = [
	'android.googleapis.com',
	'fcm.googleapis.com',
	'jmt17.google.com',
	'updates.push.services.mozilla.com',
	'updates-autopush.stage.mozaws.net',
	'updates-autopush.dev.mozaws.net',
	'*.notify.windows.com',
	'*.push.apple.com',
];
const HOST_PATTERN =
	/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;

export function createHostMatcher(
	extra?: readonly string[] | 'any',
): (host: string) => boolean {
	if (
		extra !== undefined &&
		extra !== 'any' &&
		(!Array.isArray(extra) ||
			extra.some(
				(host) => typeof host !== 'string' || !HOST_PATTERN.test(host),
			))
	)
		throw new PushpilotError(
			'invalid-config',
			'Invalid allowPushHosts. Use hostnames or *.suffix patterns.',
		);
	const patterns = [...HOSTS, ...(extra === 'any' ? [] : (extra ?? []))];
	return (host) =>
		extra === 'any' ||
		patterns.some((pattern) =>
			pattern.startsWith('*.')
				? host.endsWith(pattern.slice(1)) && host !== pattern.slice(2)
				: host === pattern,
		);
}

export function parseEndpoint(value: unknown): string {
	if (typeof value !== 'string' || value.length > 8192)
		throw new Error('Invalid endpoint');
	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		url.port ||
		url.username ||
		url.password ||
		url.hash ||
		!HOST_PATTERN.test(url.hostname) ||
		/^\d+(?:\.\d+){3}$/.test(url.hostname) ||
		url.hostname.endsWith('.localhost')
	)
		throw new Error('Invalid endpoint');
	return value;
}

function object(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export async function parseSubscription(
	value: unknown,
	match: (host: string) => boolean,
): Promise<PushSubscriptionRecord> {
	if (!object(value)) throw new Error('Invalid subscription');
	const endpoint = parseEndpoint(value.endpoint);
	if (
		!match(new URL(endpoint).hostname) ||
		typeof value.keyId !== 'string' ||
		!/^[0-9a-f]{16}$/.test(value.keyId) ||
		typeof value.p256dh !== 'string' ||
		typeof value.auth !== 'string'
	)
		throw new Error('Invalid subscription');
	const p256dh = decodeBase64(value.p256dh);
	const auth = decodeBase64(value.auth);
	if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16)
		throw new Error('Invalid subscription');
	await crypto.subtle.importKey(
		'raw',
		p256dh,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);
	return {
		endpoint,
		p256dh: encodeBase64(p256dh),
		auth: encodeBase64(auth),
		keyId: value.keyId,
	};
}

export async function parseBrowserSubscription(
	value: unknown,
	currentKeyId: string,
	match: (host: string) => boolean,
): Promise<PushSubscriptionRecord> {
	if (!object(value) || !object(value.keys))
		throw new Error('Invalid subscription');
	return parseSubscription(
		{
			endpoint: value.endpoint,
			p256dh: value.keys.p256dh,
			auth: value.keys.auth,
			keyId: currentKeyId,
		},
		match,
	);
}
