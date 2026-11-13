import { PushpilotError } from './errors.js';
import { decodeBase64, encodeBase64 } from './keys.js';
import type { PushSubscriptionRecord } from './types/index.js';
import { isObject } from './wire.js';

const PUSH_SERVICE_HOSTS = [
	'android.googleapis.com',
	'fcm.googleapis.com',
	'jmt17.google.com',
	'updates.push.services.mozilla.com',
	'updates-autopush.stage.mozaws.net',
	'updates-autopush.dev.mozaws.net',
	'*.notify.windows.com',
	'*.push.apple.com',
];
const HOSTNAME_PATTERN =
	/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/;
const KEY_ID_PATTERN = /^[0-9a-f]{16}$/;
const MAX_ENDPOINT_LENGTH = 8192;
const P256_PUBLIC_KEY_BYTES = 65;
const AUTH_SECRET_BYTES = 16;

function assertValidExtraHosts(extra: readonly string[] | 'any' | undefined) {
	if (extra === undefined || extra === 'any') return;
	if (
		!Array.isArray(extra) ||
		extra.some(
			(host) => typeof host !== 'string' || !HOSTNAME_PATTERN.test(host),
		)
	)
		throw new PushpilotError(
			'invalid-config',
			'Invalid allowPushHosts. Use hostnames or *.suffix patterns.',
		);
}

function matchesPattern(host: string, pattern: string): boolean {
	if (!pattern.startsWith('*.')) return host === pattern;
	return host.endsWith(pattern.slice(1)) && host !== pattern.slice(2);
}

/**
 * Combines known push services with explicit additions. Wildcards match
 * proper subdomains only.
 *
 * @throws {PushpilotError} `invalid-config` for a malformed host entry.
 */
export function createHostMatcher(
	extra?: readonly string[] | 'any',
): (host: string) => boolean {
	assertValidExtraHosts(extra);

	const patterns = [
		...PUSH_SERVICE_HOSTS,
		...(extra === 'any' ? [] : (extra ?? [])),
	];
	return (host) =>
		extra === 'any' ||
		patterns.some((pattern) => matchesPattern(host, pattern));
}

/** Checks endpoint syntax without contacting it or applying the current service allowlist. */
export function parseEndpoint(value: unknown): string {
	if (typeof value !== 'string' || value.length > MAX_ENDPOINT_LENGTH)
		throw new Error('Invalid endpoint');

	const url = new URL(value);
	if (
		url.protocol !== 'https:' ||
		url.port ||
		url.username ||
		url.password ||
		url.hash ||
		!HOSTNAME_PATTERN.test(url.hostname) ||
		/^\d+(?:\.\d+){3}$/.test(url.hostname) ||
		url.hostname.endsWith('.localhost')
	)
		throw new Error('Invalid endpoint');

	return value;
}

/** Revalidates stored subscriptions at the send boundary, including P-256 curve membership. */
export async function parseSubscription(
	value: unknown,
	match: (host: string) => boolean,
): Promise<PushSubscriptionRecord> {
	if (!isObject(value)) throw new Error('Invalid subscription');

	const endpoint = parseEndpoint(value.endpoint);
	if (
		!match(new URL(endpoint).hostname) ||
		typeof value.keyId !== 'string' ||
		!KEY_ID_PATTERN.test(value.keyId) ||
		typeof value.p256dh !== 'string' ||
		typeof value.auth !== 'string'
	)
		throw new Error('Invalid subscription');

	const p256dh = decodeBase64(value.p256dh);
	const auth = decodeBase64(value.auth);
	if (
		p256dh.length !== P256_PUBLIC_KEY_BYTES ||
		p256dh[0] !== 4 ||
		auth.length !== AUTH_SECRET_BYTES
	)
		throw new Error('Invalid subscription');

	// Rejects points that are well-formed bytes but not on the P-256 curve.
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

/** Flattens browser subscription JSON and assigns the server-derived current VAPID keyId. */
export async function parseBrowserSubscription(
	value: unknown,
	currentKeyId: string,
	match: (host: string) => boolean,
): Promise<PushSubscriptionRecord> {
	if (!isObject(value) || !isObject(value.keys))
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
