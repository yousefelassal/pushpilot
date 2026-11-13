/**
 * Options for `handlePush`.
 *
 * @example
 * ```ts
 * handlePush({
 *   fallback: { title: 'New activity', url: '/inbox' },
 *   icon: '/icons/192.png',
 *   badge: '/icons/badge.png',
 * });
 * ```
 */
export interface HandlePushOptions {
	/**
	 * Notification shown when a push arrives with no readable payload, or the
	 * payload is rejected. Browsers require every push to show something.
	 * Validated like any notification; `title` is required.
	 */
	readonly fallback: {
		/** Headline. Required and non-blank. */
		readonly title: string;
		/** Secondary text. */
		readonly body?: string;
		/** Where a click goes. Defaults to the service worker scope. */
		readonly url?: string;
	};
	/** Default icon URL for notifications that do not set their own. */
	readonly icon?: string;
	/** Default badge URL for notifications that do not set their own. */
	readonly badge?: string;
}
