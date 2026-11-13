function assert(value, message = 'Smoke assertion failed') {
	if (!value) throw new Error(message);
}
assert.equal = (actual, expected) =>
	assert(actual === expected, `Expected ${expected}, received ${actual}`);
assert.deepEqual = (actual, expected) =>
	assert(JSON.stringify(actual) === JSON.stringify(expected), 'Objects differ');
export async function verifyCrypto(createPush, createPushClient) {
	assert.deepEqual(createPushClient().getServerSnapshot(), {
		status: 'unknown',
	});
	const b64 = (bytes) =>
		btoa(String.fromCharCode(...bytes))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/, '');
	const un64 = (text) =>
		Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (char) =>
			char.charCodeAt(0),
		);
	const signing = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify'],
	);
	const vapidPublic = new Uint8Array(
		await crypto.subtle.exportKey('raw', signing.publicKey),
	);
	const vapidPrivate = (
		await crypto.subtle.exportKey('jwk', signing.privateKey)
	).d;
	const receiver = await crypto.subtle.generateKey(
		{ name: 'ECDH', namedCurve: 'P-256' },
		true,
		['deriveBits'],
	);
	const receiverPublic = new Uint8Array(
		await crypto.subtle.exportKey('raw', receiver.publicKey),
	);
	const auth = crypto.getRandomValues(new Uint8Array(16));
	const id = Array.from(
		new Uint8Array(await crypto.subtle.digest('SHA-256', vapidPublic)).subarray(
			0,
			8,
		),
		(byte) => byte.toString(16).padStart(2, '0'),
	).join('');
	let request;
	const push = createPush({
		vapid: {
			publicKey: b64(vapidPublic),
			privateKey: vapidPrivate,
			subject: 'mailto:test@example.com',
		},
		fetch: async (url, init) => {
			request = { url, init };
			return new Response(null, { status: 201 });
		},
	});
	const report = await push.send(
		[
			{
				endpoint: 'https://fcm.googleapis.com/send/SENTINEL',
				p256dh: b64(receiverPublic),
				auth: b64(auth),
				keyId: id,
			},
		],
		{ title: 'Packed artifact', body: 'Encrypted round trip' },
	);
	assert.equal(report.results[0].status, 'accepted');
	assert(!JSON.stringify(report).includes('SENTINEL'));
	assert(request);
	assert.equal(request.init.headers.TTL, '86400');
	assert.equal(request.init.redirect, 'manual');
	const ciphertext = new Uint8Array(request.init.body);
	assert.equal(ciphertext.length, 4096);
	const salt = ciphertext.slice(0, 16);
	const senderPublic = ciphertext.slice(21, 86);
	const senderKey = await crypto.subtle.importKey(
		'raw',
		senderPublic,
		{ name: 'ECDH', namedCurve: 'P-256' },
		false,
		[],
	);
	const secret = await crypto.subtle.deriveBits(
		{ name: 'ECDH', public: senderKey },
		receiver.privateKey,
		256,
	);
	const utf8 = (text) => new TextEncoder().encode(text);
	const concat = (...items) => {
		const bytes = new Uint8Array(
			items.reduce((size, item) => size + item.length, 0),
		);
		let offset = 0;
		for (const item of items) {
			bytes.set(item, offset);
			offset += item.length;
		}
		return bytes;
	};
	async function hkdf(input, saltBytes, info, bits) {
		const key = await crypto.subtle.importKey('raw', input, 'HKDF', false, [
			'deriveBits',
		]);
		return crypto.subtle.deriveBits(
			{ name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info },
			key,
			bits,
		);
	}
	const ikm = await hkdf(
		secret,
		auth,
		concat(utf8('WebPush: info\0'), receiverPublic, senderPublic),
		256,
	);
	const cek = await hkdf(ikm, salt, utf8('Content-Encoding: aes128gcm\0'), 128);
	const nonce = await hkdf(ikm, salt, utf8('Content-Encoding: nonce\0'), 96);
	const contentKey = await crypto.subtle.importKey(
		'raw',
		cek,
		'AES-GCM',
		false,
		['decrypt'],
	);
	const padded = new Uint8Array(
		await crypto.subtle.decrypt(
			{ name: 'AES-GCM', iv: nonce },
			contentKey,
			ciphertext.slice(86),
		),
	);
	let delimiter = padded.length - 1;
	while (padded[delimiter] === 0) delimiter--;
	assert.equal(padded[delimiter], 2);
	assert.deepEqual(
		JSON.parse(new TextDecoder().decode(padded.slice(0, delimiter))),
		{ v: 1, title: 'Packed artifact', body: 'Encrypted round trip' },
	);
	const token = /t=([^, ]+)/.exec(request.init.headers.authorization)?.[1];
	assert(token);
	const [head, claims, signature] = token.split('.');
	assert.equal(
		JSON.parse(new TextDecoder().decode(un64(claims))).aud,
		'https://fcm.googleapis.com',
	);
	assert(
		await crypto.subtle.verify(
			{ name: 'ECDSA', hash: 'SHA-256' },
			signing.publicKey,
			un64(signature),
			utf8(`${head}.${claims}`),
		),
	);
	return 'packed encryption, independent decryption, VAPID verification, and SSR import';
}
