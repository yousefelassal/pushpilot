import { decodeBase64, encodeBase64, keyId } from '../shared/keys.js';
import { ClientFailure } from './failure.js';
import { platformState } from './platform.js';
import { activeRegistration } from './registration.js';
import type {
	PushClient,
	PushClientOptions,
	PushState,
} from './types/index.js';
import type { Action, ServerConfig } from './types/internal.js';

const UNKNOWN: PushState = Object.freeze({ status: 'unknown' });
const REQUEST_TIMEOUT_MS = 10_000;

function equalKey(key: ArrayBuffer | null, expected: string): boolean {
	if (!key) return false;
	return encodeBase64(new Uint8Array(key)) === expected;
}

/** Validates the handler's config response and checks that keyId really fingerprints the key. */
async function parseServerConfig(response: Response): Promise<ServerConfig> {
	try {
		const value: unknown = await response.json();
		if (
			!value ||
			typeof value !== 'object' ||
			!('publicKey' in value) ||
			!('keyId' in value) ||
			typeof value.publicKey !== 'string' ||
			typeof value.keyId !== 'string'
		)
			throw new Error();

		const bytes = decodeBase64(value.publicKey);
		if (bytes.byteLength !== 65 || bytes[0] !== 4) throw new Error();

		const normalized = encodeBase64(bytes);
		if ((await keyId(normalized)) !== value.keyId) throw new Error();
		return { publicKey: normalized, keyId: value.keyId };
	} catch {
		throw new ClientFailure({ code: 'config' });
	}
}

/**
 * Starts a permission request without throwing. Resolves to `null` when the
 * browser rejects the request. Must run synchronously inside the user gesture.
 */
function requestPermission(): Promise<NotificationPermission | null> {
	return (
		Notification.permission === 'default'
			? Notification.requestPermission()
			: Promise.resolve(Notification.permission)
	).catch(() => null);
}

/**
 * Creates a browser push controller. It touches no browser API until
 * `start()` runs, so it is safe to create during server rendering.
 *
 * @param options Handler URL, service worker scope, and fetch override.
 * @returns A {@link PushClient} you can bind to any UI.
 *
 * @example
 * ```ts
 * import { createPushClient } from 'pushpilot/client';
 *
 * const client = createPushClient({ endpoint: '/api/push' });
 * const stop = client.start();
 * client.listen(() => render(client.getSnapshot()));
 * button.onclick = () => client.enable();
 * ```
 */
export function createPushClient(options: PushClientOptions = {}): PushClient {
	const endpoint = options.endpoint ?? '/api/push';
	const scope = options.serviceWorkerScope ?? '/';

	let snapshot = UNKNOWN;
	const listeners = new Set<() => void>();

	// Operations run one at a time; identical operations share a single run.
	const pending = new Map<Action, Promise<PushState>>();
	let tail: Promise<unknown> | null = null;

	let references = 0;
	let initialized = false;
	// True after detach(): the browser stays subscribed but the server link is removed.
	let detached = false;
	let postedEndpoint: string | null = null;
	let previousEndpoint: string | null = null;
	let config: ServerConfig | null = null;
	let registration: ServiceWorkerRegistration | null = null;

	function setState(next: PushState): PushState {
		if (JSON.stringify(snapshot) !== JSON.stringify(next)) {
			snapshot = Object.freeze(next);
			for (const listener of listeners) listener();
		}
		return snapshot;
	}

	function failed(error: unknown): PushState {
		return setState({
			status: 'error',
			error:
				error instanceof ClientFailure ? error.error : { code: 'push-service' },
		});
	}

	function run(
		name: Action,
		work: () => Promise<PushState>,
	): Promise<PushState> {
		const existing = pending.get(name);
		if (existing) return existing;

		const execute = async () => {
			try {
				return await work();
			} catch (error) {
				return failed(error);
			}
		};
		const result = tail ? tail.then(execute, execute) : execute();
		pending.set(name, result);
		tail = result;
		void result.then(() => {
			pending.delete(name);
			if (tail === result) tail = null;
		});
		return result;
	}

	async function post(body: object): Promise<Response> {
		try {
			return await (options.fetch ?? globalThis.fetch)(endpoint, {
				method: 'POST',
				credentials: 'same-origin',
				cache: 'no-store',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(body),
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
		} catch {
			throw new ClientFailure({ code: 'network' });
		}
	}

	async function discard(response: Response): Promise<void> {
		try {
			await response.body?.cancel();
		} catch {
			// The status is already known; a body that cannot be cancelled changes nothing.
		}
	}

	async function readConfig(): Promise<ServerConfig> {
		const response = await post({ action: 'config' });
		if (!response.ok) {
			await discard(response);
			throw new ClientFailure({ code: 'server', status: response.status });
		}
		return parseServerConfig(response);
	}

	/** Returns a terminal state when push is unavailable, or `null` once ready. */
	async function setup(force = false): Promise<PushState | null> {
		const platform = platformState();
		if (platform) return setState(platform);

		if (!registration || !config || force) {
			const [nextConfig, nextRegistration] = await Promise.all([
				readConfig(),
				activeRegistration(scope),
			]);
			config = nextConfig;
			registration = nextRegistration;
		}
		initialized = true;
		return null;
	}

	/**
	 * Returns the browser subscription for the current server key, replacing a
	 * subscription made under an old key. Creates one only when allowed and
	 * permission is already granted.
	 */
	async function currentSubscription(
		ready: { registration: ServiceWorkerRegistration; config: ServerConfig },
		allowCreate: boolean,
	): Promise<PushSubscription | null> {
		const { pushManager } = ready.registration;
		let subscription = await pushManager.getSubscription();

		if (
			subscription &&
			!equalKey(
				subscription.options.applicationServerKey,
				ready.config.publicKey,
			)
		) {
			// Remember the retired endpoint so the server can delete its record.
			previousEndpoint ??= subscription.endpoint;
			if (!(await subscription.unsubscribe()))
				throw new ClientFailure({ code: 'push-service' });
			subscription = null;
			allowCreate = true;
		}

		if (!subscription && allowCreate && Notification.permission === 'granted') {
			try {
				subscription = await pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: decodeBase64(ready.config.publicKey),
				});
			} catch {
				throw new ClientFailure({ code: 'push-service' });
			}
		}
		return subscription;
	}

	/** Sends the subscription to the server. On a stale key, refetches config and retries once. */
	async function register(
		subscription: PushSubscription,
		ready: { config: ServerConfig },
		raced: boolean,
	): Promise<PushState | 'stale-key'> {
		const response = await post({
			action: 'subscribe',
			publicKey: ready.config.publicKey,
			subscription: subscription.toJSON(),
			...(previousEndpoint && previousEndpoint !== subscription.endpoint
				? { previousEndpoint }
				: {}),
		});
		await discard(response);

		if (response.status === 409) {
			if (raced) throw new ClientFailure({ code: 'config' });
			return 'stale-key';
		}
		if (!response.ok)
			throw new ClientFailure({ code: 'server', status: response.status });

		postedEndpoint = subscription.endpoint;
		previousEndpoint = null;
		return setState({ status: 'subscribed' });
	}

	async function reconcile(
		force: boolean,
		allowCreate: boolean,
		raced = false,
	): Promise<PushState> {
		if (!registration || !config)
			throw new ClientFailure({ code: 'not-ready' });
		const ready = { registration, config };

		const subscription = await currentSubscription(ready, allowCreate);
		if (!subscription) return setState({ status: 'unsubscribed' });
		if (!force && postedEndpoint === subscription.endpoint)
			return setState({ status: 'subscribed' });

		const outcome = await register(subscription, ready, raced);
		if (outcome !== 'stale-key') return outcome;

		config = await readConfig();
		return reconcile(true, true, true);
	}

	function refreshVisibility(): void {
		if (document.visibilityState !== 'visible') return;
		void run('visibility', async () => {
			const platform = platformState();
			if (platform) return setState(platform);
			if (detached) return setState({ status: 'unsubscribed' });
			return (await setup()) ?? reconcile(false, false);
		});
	}

	function start(): () => void {
		references++;
		if (references === 1 && typeof document !== 'undefined') {
			document.addEventListener('visibilitychange', refreshVisibility);
			void run('initialize', async () => {
				const platform = await setup();
				if (platform) return platform;
				return detached
					? setState({ status: 'unsubscribed' })
					: reconcile(false, false);
			});
		}

		let stopped = false;
		return () => {
			if (stopped) return;
			stopped = true;
			references--;
			if (!references && typeof document !== 'undefined')
				document.removeEventListener('visibilitychange', refreshVisibility);
		};
	}

	function enable(): Promise<PushState> {
		const existing = pending.get('enable');
		if (existing) return existing;

		const platform = platformState();
		if (platform) return Promise.resolve(setState(platform));
		if (!initialized || !registration || !config)
			return Promise.resolve(failed(new ClientFailure({ code: 'not-ready' })));

		// The prompt must start synchronously, still inside the click handler's user gesture.
		let permission: Promise<NotificationPermission | null>;
		try {
			permission = requestPermission();
		} catch {
			return Promise.resolve(
				failed(new ClientFailure({ code: 'push-service' })),
			);
		}

		return run('enable', async () => {
			setState({ status: 'enabling' });
			const granted = await permission;
			if (granted === null) throw new ClientFailure({ code: 'push-service' });
			if (granted !== 'granted')
				return setState({
					status: granted === 'denied' ? 'denied' : 'unsubscribed',
				});

			detached = false;
			return reconcile(true, true);
		});
	}

	function remove(keepBrowser: boolean): Promise<PushState> {
		return run(keepBrowser ? 'detach' : 'disable', async () => {
			const platform = platformState();
			if (platform && platform.status !== 'denied') return setState(platform);

			registration ??= await activeRegistration(scope);
			setState({ status: 'disabling' });

			const subscription = await registration.pushManager.getSubscription();
			const removingEndpoint = subscription?.endpoint ?? postedEndpoint;
			if (removingEndpoint) {
				const response = await post({
					action: 'unsubscribe',
					endpoint: removingEndpoint,
				});
				await discard(response);
				if (!response.ok)
					throw new ClientFailure({ code: 'server', status: response.status });

				postedEndpoint = null;
				detached = true;
				if (!keepBrowser && subscription && !(await subscription.unsubscribe()))
					throw new ClientFailure({ code: 'push-service' });
			}

			postedEndpoint = null;
			previousEndpoint = null;
			detached = keepBrowser;
			return setState({ status: 'unsubscribed' });
		});
	}

	return {
		getSnapshot: () => snapshot,
		getServerSnapshot: () => UNKNOWN,
		listen(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		start,
		enable,
		disable: () => remove(false),
		detach: () => remove(true),
		sync: () =>
			run('sync', async () => {
				detached = false;
				return (await setup(true)) ?? reconcile(true, false);
			}),
	};
}
