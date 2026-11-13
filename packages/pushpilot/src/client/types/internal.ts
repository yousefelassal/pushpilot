/** Public key and fingerprint fetched from the handler. Internal. */
export interface ServerConfig {
	publicKey: string;
	keyId: string;
}

/** Names of serialized operations; one run per name is shared. Internal. */
export type Action =
	| 'initialize'
	| 'enable'
	| 'disable'
	| 'detach'
	| 'sync'
	| 'visibility';
