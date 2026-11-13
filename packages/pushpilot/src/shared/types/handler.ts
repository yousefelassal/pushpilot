import type { PushSubscriptionRecord } from './subscription.js';

/** Passed to `onSubscribe` after a browser subscription has been validated. */
export interface SubscribeEvent {
	/** The original request, with its body already consumed. Use it for cookies, headers, or auth. */
	readonly request: Request;
	/** The validated subscription to store. */
	readonly subscription: PushSubscriptionRecord;
	/** Endpoint this browser used before it resubscribed, or `null`. Delete the old record when set. */
	readonly previousEndpoint: string | null;
}

/** Passed to `onUnsubscribe` when a browser asks to be removed. */
export interface UnsubscribeEvent {
	/** The original request, with its body already consumed. */
	readonly request: Request;
	/** Endpoint to delete. Only its syntax is validated, so retired keys and hosts can still unsubscribe. */
	readonly endpoint: string;
}

/**
 * What a callback may return. Return nothing for success (the handler answers
 * 204). Return a `Response` with status 400 to 599 to reject the request, for
 * example a 401 when the user is not signed in. Anything else becomes a 500.
 */
export type CallbackResult = void | Response;

/**
 * Your storage and auth hooks for the subscription handler.
 * Exceptions you throw propagate to your framework.
 *
 * @example
 * ```ts
 * const callbacks: PushCallbacks = {
 *   async onSubscribe({ request, subscription, previousEndpoint }) {
 *     const user = await getUser(request);
 *     if (!user) return new Response('Sign in first', { status: 401 });
 *     await db.save(user.id, subscription, previousEndpoint);
 *   },
 *   async onUnsubscribe({ endpoint }) {
 *     await db.deleteByEndpoint(endpoint);
 *   },
 * };
 * ```
 */
export interface PushCallbacks {
	/** Called once per valid subscribe request. Persist `event.subscription`. */
	onSubscribe(event: SubscribeEvent): CallbackResult | Promise<CallbackResult>;
	/** Called once per valid unsubscribe request. Delete `event.endpoint`. */
	onUnsubscribe(
		event: UnsubscribeEvent,
	): CallbackResult | Promise<CallbackResult>;
}
