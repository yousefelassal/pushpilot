/**
 * A VAPID key pair as produced by `npx pushpilot keygen`.
 *
 * Both fields accept `string | undefined` so you can pass `process.env.X`
 * directly. `undefined` or a malformed value makes `createPush` throw an
 * `invalid-config` {@link PushpilotError}.
 */
export interface VapidKeyPair {
	/** Unpadded base64url of the 65-byte uncompressed P-256 public key. Safe to expose to browsers. */
	readonly publicKey: string | undefined;
	/** Unpadded base64url of the 32-byte P-256 private scalar. Keep it secret. */
	readonly privateKey: string | undefined;
}

/**
 * VAPID identity used to sign requests to push services.
 *
 * @example
 * ```ts
 * const vapid: VapidConfig = {
 *   subject: 'mailto:ops@example.com',
 *   publicKey: process.env.VAPID_PUBLIC_KEY,
 *   privateKey: process.env.VAPID_PRIVATE_KEY,
 *   // During rotation, keep the old pair so existing subscriptions still work.
 *   previous: [{ publicKey: process.env.OLD_PUBLIC, privateKey: process.env.OLD_PRIVATE }],
 * };
 * ```
 */
export interface VapidConfig extends VapidKeyPair {
	/** Contact for push-service operators. Either a `mailto:` address or an `https:` URL without credentials. */
	readonly subject: string | undefined;
	/**
	 * Retired key pairs that still own live subscriptions. Subscriptions
	 * created under these keys keep receiving notifications and are reported
	 * with `needsResubscribe: true`. Public keys must be unique across the
	 * current and previous pairs.
	 */
	readonly previous?: readonly VapidKeyPair[];
}
