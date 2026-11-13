/**
 * Why push cannot work in this browser.
 *
 * - `insecure-context`: the page is not served over HTTPS (or localhost).
 * - `no-service-worker`: the browser has no service worker support.
 * - `no-push-manager`: the browser has no Push API.
 * - `no-notification`: the browser has no Notification API.
 * - `ios-version`: iOS or iPadOS older than 16.4.
 */
export type UnsupportedReason =
	| 'insecure-context'
	| 'no-service-worker'
	| 'no-push-manager'
	| 'no-notification'
	| 'ios-version';

/**
 * Why the last operation failed, discriminated by `code`.
 *
 * - `network`: the request to your handler failed or timed out (10 seconds).
 * - `server`: your handler answered with a non-success `status`.
 * - `config`: the handler's configuration response was invalid, or the key kept changing.
 * - `service-worker`: no active service worker was found within 10 seconds.
 * - `push-service`: the browser refused to subscribe or unsubscribe.
 * - `not-ready`: an action ran before `start()` finished initializing.
 */
export type PushClientError =
	| { readonly code: 'network' }
	| { readonly code: 'server'; readonly status: number }
	| { readonly code: 'config' }
	| { readonly code: 'service-worker' }
	| { readonly code: 'push-service' }
	| { readonly code: 'not-ready' };

/**
 * Everything a UI needs to render a push toggle, discriminated by `status`.
 *
 * - `unknown`: not determined yet. Always the server-rendered state.
 * - `unsupported`: push cannot work here. See `reason`.
 * - `needs-install`: iOS only works from a Home Screen web app. Ask the user to install it.
 * - `denied`: the user blocked notifications. Only browser settings can undo that.
 * - `unsubscribed`: supported and ready, but no active subscription.
 * - `enabling`: permission prompt or subscription in progress.
 * - `disabling`: removal in progress.
 * - `subscribed`: this browser is subscribed and your server knows about it.
 * - `error`: the last operation failed. See `error`.
 *
 * @example
 * ```ts
 * function label(state: PushState): string {
 *   switch (state.status) {
 *     case 'subscribed': return 'Notifications on';
 *     case 'denied': return 'Blocked in browser settings';
 *     case 'needs-install': return 'Add to Home Screen first';
 *     default: return 'Enable notifications';
 *   }
 * }
 * ```
 */
export type PushState =
	| { readonly status: 'unknown' }
	| { readonly status: 'unsupported'; readonly reason: UnsupportedReason }
	| { readonly status: 'needs-install' }
	| { readonly status: 'denied' }
	| { readonly status: 'unsubscribed' }
	| { readonly status: 'enabling' }
	| { readonly status: 'disabling' }
	| { readonly status: 'subscribed' }
	| { readonly status: 'error'; readonly error: PushClientError };
