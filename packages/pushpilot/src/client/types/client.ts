import type { PushState } from './state.js';

/**
 * Browser push controller. Its shape fits React's `useSyncExternalStore`
 * and any other store-style framework binding. Methods are properties, so
 * they are safe to pass around unbound.
 *
 * Actions never reject. Failures become `{ status: 'error' }` states.
 * Concurrent calls of the same action share one run.
 */
export interface PushClient {
	/** Current state. Returns the same object until the state changes. */
	readonly getSnapshot: () => PushState;
	/** State for server rendering. Always `{ status: 'unknown' }`. */
	readonly getServerSnapshot: () => PushState;
	/**
	 * Subscribes to state changes.
	 * @param listener Called after every change.
	 * @returns A function that removes the listener.
	 */
	readonly listen: (listener: () => void) => () => void;
	/**
	 * Detects support and reconciles with the browser. Reference counted, so
	 * several consumers can call it. Re-checks when the tab becomes visible.
	 * @returns A function that releases this reference.
	 */
	readonly start: () => () => void;
	/**
	 * Asks permission if needed, subscribes, and registers with your server.
	 * Call it from a user gesture such as a click, because browsers require it for the prompt.
	 * @returns The resulting state.
	 */
	readonly enable: () => Promise<PushState>;
	/**
	 * Removes the subscription from your server and from the browser.
	 * @returns The resulting state.
	 */
	readonly disable: () => Promise<PushState>;
	/**
	 * Removes the subscription from your server only, for example at sign-out.
	 * The browser keeps its subscription, and `start()` will not re-register it until `enable()` or `sync()`.
	 * @returns The resulting state.
	 */
	readonly detach: () => Promise<PushState>;
	/**
	 * Re-reads server configuration and re-registers the existing subscription.
	 * Call it after sign-in so the server links the browser to the new user.
	 * @returns The resulting state.
	 */
	readonly sync: () => Promise<PushState>;
}
