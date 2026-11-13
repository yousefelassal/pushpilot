import type { Json } from './json.js';

/** A button shown on a notification. */
export interface NotificationAction {
	/** Identifier reported when the button is clicked. Non-empty. */
	readonly action: string;
	/** Button label. Non-empty. */
	readonly title: string;
	/** Same-origin or absolute `https:` URL to open when this button is clicked. Defaults to the notification `url`. */
	readonly url?: string;
}

/**
 * The fields of a notification. The whole message, encoded as JSON with a
 * version marker, must fit in 3993 UTF-8 bytes or `send` throws
 * `payload-too-large`.
 */
export interface NotificationContent {
	/** Headline. Required and non-blank. */
	readonly title: string;
	/** Secondary text under the title. */
	readonly body?: string;
	/** Where a click goes. Absolute `https:` URL or a path relative to the service worker scope, without credentials. Defaults to the scope root. */
	readonly url?: string;
	/** Large icon URL (`https:` or relative, no credentials). */
	readonly icon?: string;
	/** Small monochrome status-bar icon URL (`https:` or relative, no credentials). */
	readonly badge?: string;
	/** Large preview image URL (`https:` or relative, no credentials). Not shown on every platform. */
	readonly image?: string;
	/** Keep the notification visible until the user acts. Defaults to the platform behavior. */
	readonly requireInteraction?: boolean;
	/** Suppress sound and vibration. Defaults to `false`. */
	readonly silent?: boolean;
	/** Buttons shown on the notification. Platforms display a limited number. */
	readonly actions?: readonly NotificationAction[];
	/** Arbitrary JSON delivered to the service worker. It counts toward the payload limit. */
	readonly data?: { readonly [key: string]: Json };
}

/**
 * A notification ready to send.
 *
 * `renotify` is only meaningful when `tag` is set: a new notification with
 * the same `tag` replaces the old one, and `renotify: true` alerts the user
 * again when it does.
 *
 * @example
 * ```ts
 * const notification: PushNotification = {
 *   title: 'Order shipped',
 *   body: 'Arrives Thursday.',
 *   url: '/orders/42',
 *   tag: 'order-42',
 *   renotify: true,
 *   actions: [{ action: 'track', title: 'Track', url: '/orders/42/track' }],
 * };
 * ```
 */
export type PushNotification = NotificationContent &
	(
		| {
				/** Groups notifications so a newer one replaces an older one. */
				readonly tag?: undefined;
				readonly renotify?: false;
		  }
		| {
				/** Groups notifications so a newer one replaces an older one. Non-blank. */
				readonly tag: string;
				/** Alert the user again when this notification replaces one with the same `tag`. Defaults to `false`. */
				readonly renotify?: boolean;
		  }
	);
