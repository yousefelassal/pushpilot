/**
 * Delivery hints sent to the push service for one `send` call.
 *
 * @example
 * ```ts
 * await push.send(subs, notification, { ttl: 3600, urgency: 'high' });
 * ```
 */
export interface SendOptions {
	/** How long the push service may hold an undelivered message, in seconds. Integer from 1 to 2419200 (28 days). Defaults to 86400 (one day). */
	readonly ttl?: number;
	/** Delivery priority. Higher urgency may wake a sleeping device sooner and cost battery. Defaults to `'normal'`. */
	readonly urgency?: 'very-low' | 'low' | 'normal' | 'high';
}
