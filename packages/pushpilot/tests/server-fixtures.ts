import { encodeBase64, keyId } from '../src/shared/keys.js';
import type { PushSubscriptionRecord } from '../src/shared/types.js';

export async function pair() {
	const keys = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify'],
	);
	const raw = new Uint8Array(
		await crypto.subtle.exportKey('raw', keys.publicKey),
	);
	const privateJwk = await crypto.subtle.exportKey('jwk', keys.privateKey);
	if (!privateJwk.d) throw new Error('Missing private key');
	return { publicKey: encodeBase64(raw), privateKey: privateJwk.d };
}

export async function fixture() {
	const vapid = { ...(await pair()), subject: 'mailto:ops@example.com' };
	const receiver = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits'],
	);
	const subscription: PushSubscriptionRecord = {
		endpoint: 'https://fcm.googleapis.com/push/sentinel-capability',
		p256dh: encodeBase64(
			new Uint8Array(await crypto.subtle.exportKey('raw', receiver.publicKey)),
		),
		auth: encodeBase64(crypto.getRandomValues(new Uint8Array(16))),
		keyId: await keyId(vapid.publicKey),
	};
	return { vapid, subscription, receiver };
}
