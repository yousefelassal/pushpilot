import { PushpilotError } from './errors.js';
import type {
	NormalizedVapidConfig,
	PreparedKey,
	PreparedKeys,
} from './types/internal.js';
import type { VapidConfig } from './types/index.js';

const PUBLIC_KEY_BYTES = 65;
const PRIVATE_KEY_BYTES = 32;
const KEY_PAIR_CHECK_MESSAGE = 'pushpilot key pair check';
const ECDSA_SHA256 = { name: 'ECDSA', hash: 'SHA-256' } as const;
const P256_ECDSA = { name: 'ECDSA', namedCurve: 'P-256' } as const;

/** Encodes raw key bytes as unpadded base64url, as required by browser push APIs. */
export function encodeBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);

	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

/** Decodes canonical base64url, accepting optional padding and rejecting truncated encodings. */
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
	if (
		!/^[A-Za-z0-9_-]+={0,2}$/.test(value) ||
		value.replace(/=+$/, '').length % 4 === 1
	)
		throw new Error('Invalid base64url');

	const normalized = value.replace(/=+$/, '');
	const binary = atob(normalized.replace(/-/g, '+').replace(/_/g, '/'));
	const result = Uint8Array.from(binary, (char) => char.charCodeAt(0));

	// Rejects non-canonical trailing bits that decode to the same bytes.
	if (encodeBase64(result) !== normalized) throw new Error('Invalid base64url');
	return result;
}

/**
 * Validates key encoding and length without including secret input in errors.
 *
 * @throws {PushpilotError} `invalid-config` naming `field`, never the value.
 */
export function normalizeKey(
	value: unknown,
	length: number,
	field: string,
): string {
	try {
		if (typeof value !== 'string') throw new Error();
		const bytes = decodeBase64(value);
		if (
			bytes.length !== length ||
			(length === PUBLIC_KEY_BYTES && bytes[0] !== 4)
		)
			throw new Error();
		return encodeBase64(bytes);
	} catch {
		throw new PushpilotError(
			'invalid-config',
			`Invalid ${field}. Run pushpilot keygen.`,
		);
	}
}

/** Fingerprints the decoded VAPID public key using the first eight SHA-256 bytes, as 16 hex characters. */
export async function keyId(publicKey: string): Promise<string> {
	const hash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', decodeBase64(publicKey)),
	);
	return Array.from(hash.subarray(0, 8), (value) =>
		value.toString(16).padStart(2, '0'),
	).join('');
}

function assertValidSubject(subject: unknown): asserts subject is string {
	if (typeof subject !== 'string')
		throw new PushpilotError(
			'invalid-config',
			'Set vapid.subject to a mailto address or HTTPS URL.',
		);

	try {
		const url = new URL(subject);
		if (url.protocol === 'mailto:') {
			if (!/^[^\s@/?#]+@[^\s@/?#]+\.[^\s@/?#]+$/.test(url.pathname))
				throw new Error();
		} else if (
			url.protocol !== 'https:' ||
			!url.hostname ||
			url.username ||
			url.password
		)
			throw new Error();
	} catch {
		throw new PushpilotError(
			'invalid-config',
			'Invalid vapid.subject. Use a mailto address or HTTPS URL.',
		);
	}
}

/**
 * Normalizes configuration synchronously. Curve membership and key pairing
 * need `prepareKeys`.
 *
 * @throws {PushpilotError} `invalid-config` for a bad subject, key, or duplicate public key.
 */
export function validateVapid(vapid: VapidConfig): NormalizedVapidConfig {
	if (!vapid)
		throw new PushpilotError(
			'invalid-config',
			'Set vapid.subject to a mailto address or HTTPS URL.',
		);
	assertValidSubject(vapid.subject);

	if (vapid.previous !== undefined && !Array.isArray(vapid.previous))
		throw new PushpilotError('invalid-config', 'Invalid vapid.previous.');

	const seen = new Set<string>();
	const pairs = [vapid, ...(vapid.previous ?? [])].map((pair) => {
		const publicKey = normalizeKey(
			pair?.publicKey,
			PUBLIC_KEY_BYTES,
			'vapid.publicKey',
		);
		const privateKey = normalizeKey(
			pair?.privateKey,
			PRIVATE_KEY_BYTES,
			'vapid.privateKey',
		);
		if (seen.has(publicKey))
			throw new PushpilotError('invalid-config', 'Duplicate VAPID public key.');
		seen.add(publicKey);
		return { publicKey, privateKey };
	});

	const [current, ...previous] = pairs;
	if (!current)
		throw new PushpilotError('invalid-config', 'Missing VAPID key.');
	return { ...current, subject: vapid.subject, previous };
}

/** Importing JWK coordinates alone does not prove the private scalar matches them, so sign and verify. */
async function assertKeyPairMatches(
	publicKey: string,
	privateKey: string,
): Promise<void> {
	const raw = decodeBase64(publicKey);
	const jwk = {
		kty: 'EC',
		crv: 'P-256',
		x: encodeBase64(raw.subarray(1, 33)),
		y: encodeBase64(raw.subarray(33)),
		d: privateKey,
	};
	const signing = await crypto.subtle.importKey('jwk', jwk, P256_ECDSA, false, [
		'sign',
	]);
	const verifying = await crypto.subtle.importKey(
		'raw',
		raw,
		P256_ECDSA,
		false,
		['verify'],
	);

	const message = new TextEncoder().encode(KEY_PAIR_CHECK_MESSAGE);
	const signature = await crypto.subtle.sign(ECDSA_SHA256, signing, message);
	if (
		!(await crypto.subtle.verify(ECDSA_SHA256, verifying, signature, message))
	)
		throw new Error();
}

async function prepareKey(
	pair: { publicKey: string; privateKey: string },
	subject: string,
): Promise<PreparedKey> {
	const { publicKey, privateKey } = pair;
	await assertKeyPairMatches(publicKey, privateKey);
	return { publicKey, privateKey, keyId: await keyId(publicKey), subject };
}

/**
 * Imports and verifies every configured pair before any recipient can be contacted.
 *
 * @throws {PushpilotError} `invalid-config` when a pair is malformed, mismatched, or duplicated.
 */
export async function prepareKeys(config: VapidConfig): Promise<PreparedKeys> {
	const vapid = validateVapid(config);
	try {
		const keys = await Promise.all(
			[vapid, ...vapid.previous].map((pair) => prepareKey(pair, vapid.subject)),
		);
		const byId = new Map(keys.map((key) => [key.keyId, key]));
		const current = keys[0];
		if (!current || byId.size !== keys.length) throw new Error();
		return { current, byId };
	} catch {
		throw new PushpilotError(
			'invalid-config',
			'VAPID keys are invalid or do not match. Run pushpilot doctor.',
		);
	}
}
