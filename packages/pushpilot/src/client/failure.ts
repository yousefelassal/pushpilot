import type { PushClientError } from './types/index.js';

/** Internal exception that carries a typed error into the `error` state. */
export class ClientFailure extends Error {
	constructor(readonly error: PushClientError) {
		super(error.code);
	}
}
