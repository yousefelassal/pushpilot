export type UnsupportedReason =
	| 'insecure-context'
	| 'no-service-worker'
	| 'no-push-manager'
	| 'no-notification'
	| 'ios-version';
export type PushClientError =
	| { readonly code: 'network' }
	| { readonly code: 'server'; readonly status: number }
	| { readonly code: 'config' }
	| { readonly code: 'service-worker' }
	| { readonly code: 'push-service' }
	| { readonly code: 'not-ready' };
export type PushState =
	| { readonly status: 'unknown' }
	| { readonly status: 'unsupported'; readonly reason: UnsupportedReason }
	| { readonly status: 'needs-install' }
	| { readonly status: 'denied' }
	| { readonly status: 'unsubscribed' }
	| { readonly status: 'enabling' }
	| { readonly status: 'disabling' }
	| { readonly status: 'subscribed' }
	| { readonly status: 'error'; readonly error: PushClientError };
export interface PushClientOptions {
	readonly endpoint?: string; // Default /api/push.
	readonly serviceWorkerScope?: string; // Default /.
	readonly fetch?: (url: string, init: RequestInit) => Promise<Response>;
}
export interface PushClient {
	getSnapshot(): PushState;
	getServerSnapshot(): PushState;
	listen(listener: () => void): () => void;
	start(): () => void;
	enable(): Promise<PushState>;
	disable(): Promise<PushState>;
	detach(): Promise<PushState>;
	sync(): Promise<PushState>;
}
