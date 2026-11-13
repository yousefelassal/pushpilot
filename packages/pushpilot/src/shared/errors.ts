import type { PushpilotErrorCode } from './types/index.js';

/**
 * Thrown for problems the caller can fix: bad configuration, an invalid
 * notification, or a payload that cannot fit in one push message.
 *
 * Network and push-service failures never throw. They are reported per
 * recipient in {@link SendReport}.
 *
 * @example
 * ```ts
 * try {
 *   await push.send(subscriptions, notification);
 * } catch (error) {
 *   if (error instanceof PushpilotError && error.code === 'payload-too-large') {
 *     // shorten the body or move data behind a URL
 *   }
 * }
 * ```
 */
export class PushpilotError extends Error {
	/**
	 * @param code Stable machine-readable reason. Safe to branch on.
	 * @param message Human-readable explanation. It never contains key material.
	 */
	constructor(
		readonly code: PushpilotErrorCode,
		message: string,
	) {
		super(message);
		this.name = 'PushpilotError';
	}
}
