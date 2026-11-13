import { prepareKeys, validateVapid } from '../shared/keys.js';
import { createHostMatcher } from '../shared/subscription.js';
import { encodePayload, isObject } from '../shared/wire.js';
import { PushpilotError, type Push, type PushConfig } from '../shared/types.js';
import { deliver } from './deliver.js';
import { createHandler } from './handler.js';

export { PushpilotError } from '../shared/types.js';
export type * from '../shared/types.js';

export function createPush(config: PushConfig): Push {
	if (!isObject(config) || !isObject(config.vapid)) {
		throw new PushpilotError(
			'invalid-config',
			'vapid configuration is required.',
		);
	}
	if (config.fetch !== undefined && typeof config.fetch !== 'function') {
		throw new PushpilotError('invalid-config', 'fetch must be a function.');
	}
	const vapid = validateVapid(config.vapid);
	const matchHost = createHostMatcher(config.allowPushHosts);
	let keys: ReturnType<typeof prepareKeys> | undefined;
	const getKeys = () => {
		keys ??= prepareKeys(vapid).catch(() => {
			throw new PushpilotError(
				'invalid-config',
				'VAPID keys are invalid. Run pushpilot doctor.',
			);
		});
		return keys;
	};
	const fetcher =
		config.fetch ??
		((url: string, init: RequestInit) => globalThis.fetch(url, init));
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
