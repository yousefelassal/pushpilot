import { PushpilotError } from '../shared/errors.js';
import { prepareKeys, validateVapid } from '../shared/keys.js';
import { createHostMatcher } from '../shared/subscription.js';
import type { Push, PushConfig } from '../shared/types/index.js';
import type { PreparedKeys } from '../shared/types/internal.js';
import { encodePayload, isObject } from '../shared/wire.js';
import { deliver } from './deliver.js';
import { createHandler } from './handler.js';

export { PushpilotError } from '../shared/errors.js';
export type * from '../shared/types/index.js';

function assertConfigShape(config: PushConfig): void {
	if (!isObject(config) || !isObject(config.vapid))
		throw new PushpilotError(
			'invalid-config',
			'vapid configuration is required.',
		);
	if (config.fetch !== undefined && typeof config.fetch !== 'function')
		throw new PushpilotError('invalid-config', 'fetch must be a function.');
}

/**
 * Creates a sender and a subscription handler factory. Makes no network
 * calls. The configuration shape is checked immediately; key import and
 * pair verification happen lazily on first use and are cached.
 *
 * @param config VAPID identity plus optional host allowlist and fetch override.
 * @returns An object with `send` and `handler`.
 * @throws {PushpilotError} `invalid-config` if the VAPID configuration or host policy is malformed.
 *
 * @example
 * ```ts
 * import { createPush } from 'pushpilot/server';
 *
 * export const push = createPush({
 *   vapid: {
 *     subject: 'mailto:ops@example.com',
 *     publicKey: process.env.VAPID_PUBLIC_KEY,
 *     privateKey: process.env.VAPID_PRIVATE_KEY,
 *   },
 * });
 *
 * const report = await push.send(subscriptions, { title: 'Hello' });
 * ```
 */
export function createPush(config: PushConfig): Push {
	assertConfigShape(config);
	const vapid = validateVapid(config.vapid);
	const matchHost = createHostMatcher(config.allowPushHosts);
	const fetcher =
		config.fetch ??
		((url: string, init: RequestInit) => globalThis.fetch(url, init));

	let keys: Promise<PreparedKeys> | undefined;
	const getKeys = () => {
		keys ??= prepareKeys(vapid).catch(() => {
			throw new PushpilotError(
				'invalid-config',
				'VAPID keys are invalid. Run pushpilot doctor.',
			);
		});
		return keys;
	};

	return {
		async send(subscriptions, notification, options) {
			const encoded = encodePayload(notification, options);
			const prepared = await getKeys();
			return deliver({
				subscriptions,
				...encoded,
				keys: prepared,
				matchHost,
				fetcher,
			});
		},
		handler(callbacks) {
			return createHandler({ callbacks, getKeys, matchHost });
		},
	};
}
