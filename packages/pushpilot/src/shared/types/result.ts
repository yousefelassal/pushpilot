/** Failure reasons worth retrying later. `send` already retried once before reporting them. */
export type RetryableReason = 'rate-limited' | 'server-error' | 'network';

/**
 * Failure reasons that will not improve by retrying the same request.
 *
 * - `invalid-subscription`: the stored record is malformed or its keys cannot encrypt. Delete it.
 * - `configuration`: the push service rejected your VAPID credentials (HTTP 401 or 403).
 * - `not-attempted`: skipped because an earlier request to the same service and key was rejected for configuration.
 * - `bad-request`: HTTP 400.
 * - `payload-too-large`: HTTP 413.
 * - `redirect`: the push service answered with a 3xx. Redirects are never followed.
 * - `unexpected`: any other status.
 */
export type PermanentReason =
	| 'invalid-subscription'
	| 'configuration'
	| 'not-attempted'
	| 'bad-request'
	| 'payload-too-large'
	| 'redirect'
	| 'unexpected';

/** Fields present on every {@link DeliveryResult}. */
export interface ResultBase {
	/** Position of the subscription in the array passed to `send`. */
	readonly index: number;
	/** First 8 bytes of the SHA-256 of the endpoint, in hex. Safe to log. Empty when the endpoint was not a string. */
	readonly endpointHash: string;
	/** HTTP requests made for this recipient. `0` when nothing was sent. */
	readonly attempts: 0 | 1 | 2;
	/** `true` when the subscription was created under a retired VAPID key. Ask the browser to resubscribe. */
	readonly needsResubscribe: boolean;
}

/**
 * Outcome for one recipient, discriminated by `status`.
 *
 * - `accepted`: the push service queued the message (HTTP 2xx).
 * - `gone`: the subscription expired (404 or 410). Delete it.
 * - `outdated`: the subscription's `keyId` matches no configured VAPID key. Delete it or resubscribe.
 * - `failed`: delivery did not succeed. Check `retryable` and `reason`.
 *
 * @example
 * ```ts
 * for (const result of report.results) {
 *   if (result.status === 'gone' || result.status === 'outdated') {
 *     await db.subscriptions.delete(subscriptions[result.index].endpoint);
 *   } else if (result.status === 'failed' && result.retryable) {
 *     await queue.retryLater(subscriptions[result.index]);
 *   }
 * }
 * ```
 */
export type DeliveryResult = ResultBase &
	(
		| {
				readonly status: 'accepted';
				/** HTTP status from the push service, 200 to 299. */
				readonly httpStatus: number;
		  }
		| { readonly status: 'gone'; readonly httpStatus: 404 | 410 }
		| { readonly status: 'outdated'; readonly httpStatus: null }
		| ({
				readonly status: 'failed';
				/** HTTP status from the push service, or `null` when no response arrived. */
				readonly httpStatus: number | null;
		  } & (
				| {
						readonly reason: RetryableReason;
						readonly retryable: true;
				  }
				| {
						readonly reason: PermanentReason;
						readonly retryable: false;
				  }
		  ))
	);

/** What `send` resolves with. */
export interface SendReport {
	/** One result per input subscription, in input order. Empty when no subscriptions were given. */
	readonly results: readonly DeliveryResult[];
}
