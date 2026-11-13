import type { vapidHeaders } from '@block65/webcrypto-web-push';
import type { PreparedKey, PreparedKeys } from '../../shared/types/internal.js';
import type {
	PushSubscriptionRecord,
	ResultBase,
} from '../../shared/types/index.js';

/** Everything `deliver` needs for one `send` call. Internal. */
export interface DeliveryInput {
	subscriptions: readonly PushSubscriptionRecord[];
	payload: Uint8Array<ArrayBuffer>;
	ttl: number;
	urgency: string;
	keys: PreparedKeys;
	matchHost: (host: string) => boolean;
	fetcher: (url: string, init: RequestInit) => Promise<Response>;
}

/** Outcome of one HTTP request; `status` is `null` when no response arrived. Internal. */
export type Attempt =
	| { status: number; retryAfter: string | null }
	| { status: null; retryAfter: null };

/** Signed VAPID headers, shared by every recipient of one push-service origin and key. Internal. */
export type VapidAuthorization = Awaited<ReturnType<typeof vapidHeaders>>;

/** Mutable state shared by the concurrent workers of one batch. Internal. */
export interface BatchState {
	input: DeliveryInput;
	/** Groups whose VAPID credentials were rejected; later requests to them are skipped. */
	blocked: Set<string>;
	headersByGroup: Map<string, Promise<VapidAuthorization>>;
}

/** A subscription that passed validation and has a matching signing key. Internal. */
export interface Recipient {
	subscription: PushSubscriptionRecord;
	key: PreparedKey;
	base: ResultBase;
	/** Origin plus key id: the unit that shares a VAPID audience and signing key. */
	group: string;
}
