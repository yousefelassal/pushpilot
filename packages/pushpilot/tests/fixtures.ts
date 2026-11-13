import { encodeBase64, keyId } from '../src/shared/keys.js';
export async function vapid() {
	const pair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify'],
	);
	const publicKey = encodeBase64(
		new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
	);
	const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
	if (!jwk.d) throw new Error('Missing key');
	return { publicKey, privateKey: jwk.d, subject: 'mailto:test@example.com' };
}
export async function subscription(
	publicKey: string,
	endpoint = 'https://fcm.googleapis.com/send/secret-endpoint',
) {
	const pair = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits'],
	);
	return {
		endpoint,
		p256dh: encodeBase64(
			new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
		),
		auth: encodeBase64(crypto.getRandomValues(new Uint8Array(16))),
		keyId: await keyId(publicKey),
	};
}
