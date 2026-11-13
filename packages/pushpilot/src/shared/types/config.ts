import type { VapidConfig } from './vapid.js';

/**
 * Options for `createPush`.
 *
 * @example
 * ```ts
 * const push = createPush({
 *   vapid: {
 *     subject: 'mailto:ops@example.com',
 *     publicKey: process.env.VAPID_PUBLIC_KEY,
 *     privateKey: process.env.VAPID_PRIVATE_KEY,
 *   },
 * });
 * ```
 */
export interface PushConfig {
	/** VAPID identity and optional retired keys. Required. */
	readonly vapid: VapidConfig;
	/**
	 * Push-service hosts accepted in addition to the built-in list (Google FCM,
	 * Mozilla autopush, Windows WNS, Apple). Entries are hostnames or
	 * `*.suffix` patterns, where a wildcard matches proper subdomains only.
	 * Pass `'any'` to disable the allowlist, for example in a trusted egress
	 * environment. Defaults to the built-in list only.
	 */
	readonly allowPushHosts?: readonly string[] | 'any';
	/**
	 * Replacement for `globalThis.fetch`, used for requests to push services.
	 * Useful for proxies, tests, or runtimes without a global fetch. Defaults
	 * to `globalThis.fetch`.
	 */
	readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}
