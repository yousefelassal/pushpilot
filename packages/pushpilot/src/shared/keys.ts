import { PushpilotError, type VapidConfig } from './types.js';

export function encodeBase64(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, '');
}

export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
	if (
		!/^[A-Za-z0-9_-]+={0,2}$/.test(value) ||
		value.replace(/=+$/, '').length % 4 === 1
	)
		throw new Error('Invalid base64url');
	const normalized = value.replace(/=+$/, '');
	const binary = atob(normalized.replace(/-/g, '+').replace(/_/g, '/'));
	const result = Uint8Array.from(binary, (char) => char.charCodeAt(0));
	if (encodeBase64(result) !== normalized) throw new Error('Invalid base64url');
	return result;
}

export function normalizeKey(
	value: unknown,
	length: number,
	field: string,
): string {
	try {
		if (typeof value !== 'string') throw new Error();
		const bytes = decodeBase64(value);
		if (bytes.length !== length || (length === 65 && bytes[0] !== 4))
			throw new Error();
		return encodeBase64(bytes);
	} catch {
		throw new PushpilotError(
			'invalid-config',
			`Invalid ${field}. Run pushpilot keygen.`,
		);
	}
}

export async function keyId(publicKey: string): Promise<string> {
	const hash = new Uint8Array(
		await crypto.subtle.digest('SHA-256', decodeBase64(publicKey)),
	);
	return Array.from(hash.subarray(0, 8), (value) =>
		value.toString(16).padStart(2, '0'),
	).join('');
}

export interface PreparedKey {
	publicKey: string;
	privateKey: string;
	keyId: string;
	subject: string;
}

export function validateVapid(vapid: VapidConfig): VapidConfig {
	if (!vapid || typeof vapid.subject !== 'string')
		throw new PushpilotError(
			'invalid-config',
			'Set vapid.subject to a mailto address or HTTPS URL.',
		);
	try {
		const url = new URL(vapid.subject);
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
	if (vapid.previous !== undefined && !Array.isArray(vapid.previous))
		throw new PushpilotError('invalid-config', 'Invalid vapid.previous.');
	const seen = new Set<string>();
	const pairs = [vapid, ...(vapid.previous ?? [])].map((pair) => {
		const publicKey = normalizeKey(pair?.publicKey, 65, 'vapid.publicKey');
		const privateKey = normalizeKey(pair?.privateKey, 32, 'vapid.privateKey');
		if (seen.has(publicKey))
			throw new PushpilotError('invalid-config', 'Duplicate VAPID public key.');
		seen.add(publicKey);
		return { publicKey, privateKey };
	});
	const current = pairs[0];
	if (!current)
		throw new PushpilotError('invalid-config', 'Missing VAPID key.');
	return { ...current, subject: vapid.subject, previous: pairs.slice(1) };
}

export async function prepareKeys(
	config: VapidConfig,
): Promise<{ current: PreparedKey; byId: Map<string, PreparedKey> }> {
	const vapid = validateVapid(config);
	try {
		const keys = await Promise.all(
			[vapid, ...(vapid.previous ?? [])].map(async (pair) => {
				const publicKey = normalizeKey(pair.publicKey, 65, 'vapid.publicKey');
				const privateKey = normalizeKey(
					pair.privateKey,
					32,
					'vapid.privateKey',
				);
				const raw = decodeBase64(publicKey);
				const jwk = {
					kty: 'EC',
					crv: 'P-256',
					x: encodeBase64(raw.subarray(1, 33)),
					y: encodeBase64(raw.subarray(33)),
					d: privateKey,
				};
				const signing = await crypto.subtle.importKey(
					'jwk',
					jwk,
					{ name: 'ECDSA', namedCurve: 'P-256' },
					false,
					['sign'],
				);
				const verifying = await crypto.subtle.importKey(
					'raw',
					raw,
					{ name: 'ECDSA', namedCurve: 'P-256' },
					false,
					['verify'],
				);
				const message = new TextEncoder().encode('pushpilot key pair check');
				const signature = await crypto.subtle.sign(
					{ name: 'ECDSA', hash: 'SHA-256' },
					signing,
					message,
				);
				if (
					!(await crypto.subtle.verify(
						{ name: 'ECDSA', hash: 'SHA-256' },
						verifying,
						signature,
						message,
					))
				)
					throw new Error();
				return {
					publicKey,
					privateKey,
					keyId: await keyId(publicKey),
					subject: vapid.subject!,
				};
			}),
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
