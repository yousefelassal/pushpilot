/**
 * Options for `createPushClient`.
 *
 * @example
 * ```ts
 * const client = createPushClient({ endpoint: '/api/push', serviceWorkerScope: '/app/' });
 * ```
 */
export interface PushClientOptions {
	/** URL of your `push.handler()` route. Same-origin POST. Defaults to `/api/push`. */
	readonly endpoint?: string;
	/** Scope of the service worker registration that calls `handlePush`. Defaults to `/`. */
	readonly serviceWorkerScope?: string;
	/** Replacement for `globalThis.fetch`, used for requests to your handler. Defaults to `globalThis.fetch`. */
	readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}
