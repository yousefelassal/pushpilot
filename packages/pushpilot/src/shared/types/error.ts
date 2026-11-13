/**
 * Reason carried by a {@link PushpilotError}.
 *
 * - `invalid-config`: VAPID keys, subject, host list, or `fetch` are malformed.
 * - `invalid-notification`: a notification field or send option is invalid.
 * - `payload-too-large`: the encoded notification exceeds 3993 UTF-8 bytes.
 */
export type PushpilotErrorCode =
	| 'invalid-config'
	| 'invalid-notification'
	| 'payload-too-large';
