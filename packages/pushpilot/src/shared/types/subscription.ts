/**
 * A validated browser subscription, in the flat shape you should store.
 * The handler produces these in `onSubscribe`; `send` accepts them back.
 *
 * @example
 * ```ts
 * const record: PushSubscriptionRecord = await db.subscriptions.find(userId);
 * await push.send([record], { title: 'Hello' });
 * ```
 */
export interface PushSubscriptionRecord {
	/** HTTPS push-service URL that uniquely identifies the browser. Treat it as a secret capability. */
	readonly endpoint: string;
	/** Browser public key (`p256dh`), unpadded base64url of 65 bytes. */
	readonly p256dh: string;
	/** Browser authentication secret, unpadded base64url of 16 bytes. */
	readonly auth: string;
	/** 16-character hex fingerprint of the VAPID public key this subscription was created under. */
	readonly keyId: string;
}
