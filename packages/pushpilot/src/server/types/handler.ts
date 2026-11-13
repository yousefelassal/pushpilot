import type { PreparedKeys } from '../../shared/types/internal.js';
import type { PushCallbacks } from '../../shared/types/index.js';

/** Machine-readable error codes returned by the subscription handler. Internal. */
export type HandlerErrorCode =
	| 'invalid-request'
	| 'invalid-subscription'
	| 'stale-key'
	| 'body-too-large'
	| 'unsupported-media-type'
	| 'method-not-allowed'
	| 'forbidden-origin'
	| 'internal';

/** Dependencies of `createHandler`. Internal. */
export interface HandlerInput {
	callbacks: PushCallbacks;
	getKeys: () => Promise<PreparedKeys>;
	matchHost: (host: string) => boolean;
}
