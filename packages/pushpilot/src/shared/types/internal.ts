/** A VAPID pair that passed encoding checks and, after `prepareKeys`, the sign/verify pairing check. Internal. */
export interface PreparedKey {
	publicKey: string;
	privateKey: string;
	keyId: string;
	subject: string;
}

/** Keys prepared for the current config, indexed for lookup by a subscription's `keyId`. Internal. */
export interface PreparedKeys {
	current: PreparedKey;
	byId: Map<string, PreparedKey>;
}

/** `VapidConfig` after synchronous validation and normalization. Internal. */
export interface NormalizedVapidConfig {
	publicKey: string;
	privateKey: string;
	subject: string;
	previous: ReadonlyArray<{ publicKey: string; privateKey: string }>;
}
