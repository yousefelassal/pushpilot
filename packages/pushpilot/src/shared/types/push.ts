import type { PushCallbacks } from './handler.js';
import type { PushNotification } from './notification.js';
import type { SendReport } from './result.js';
import type { SendOptions } from './send.js';
import type { PushSubscriptionRecord } from './subscription.js';

/** The object returned by `createPush`. */
export interface Push {
	/**
	 * Encrypts one notification and delivers it to every subscription.
	 *
	 * Each recipient gets one result, in input order. Up to six requests run
	 * at once, each is bounded by a 10 second deadline, and transient failures
	 * are retried once. Per-recipient problems never throw.
	 *
	 * @param subscriptions Records saved from `onSubscribe`.
	 * @param notification Content to show. Validated before any network call.
	 * @param options Time-to-live and urgency.
	 * @returns One {@link DeliveryResult} per subscription.
	 * @throws {PushpilotError} `invalid-notification`, `payload-too-large`, or `invalid-config`.
	 *
	 * @example
	 * ```ts
	 * const report = await push.send(subscriptions, { title: 'Hello' }, { urgency: 'high' });
	 * const gone = report.results.filter((r) => r.status === 'gone');
	 * ```
	 */
	send(
		subscriptions: readonly PushSubscriptionRecord[],
		notification: PushNotification,
		options?: SendOptions,
	): Promise<SendReport>;

	/**
	 * Builds a standard `Request` to `Response` function that serves the
	 * browser client: it returns the public key and accepts subscribe and
	 * unsubscribe calls. POST only, same-origin only, JSON bodies up to 16 KiB.
	 *
	 * @param callbacks Where to store and delete subscriptions.
	 * @returns A function you can mount in any fetch-style framework.
	 *
	 * @example
	 * ```ts
	 * const handle = push.handler(callbacks);
	 * export const POST = (request: Request) => handle(request);
	 * ```
	 */
	handler(callbacks: PushCallbacks): (request: Request) => Promise<Response>;
}
