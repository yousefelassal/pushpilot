import { decodeBase64, encodeBase64, keyId } from '../shared/keys.js';
import type {
	PushClient,
	PushClientError,
	PushClientOptions,
	PushState,
} from './types.js';
import { platformState } from './platform.js';

const UNKNOWN: PushState = Object.freeze({ status: 'unknown' });
class ClientFailure extends Error {
	constructor(readonly error: PushClientError) {
		super(error.code);
	}
}
type Config = { publicKey: string; keyId: string };
type Action =
	| 'initialize'
	| 'enable'
	| 'disable'
	| 'detach'
	| 'sync'
	| 'visibility';

function equalKey(key: ArrayBuffer | null, expected: string): boolean {
	if (!key) return false;
	return encodeBase64(new Uint8Array(key)) === expected;
}

async function activeRegistration(
	scope: string,
): Promise<ServiceWorkerRegistration> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stop = () => {};
	let settled = false;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(
			() => reject(new ClientFailure({ code: 'service-worker' })),
			10_000,
		);
	});
	try {
		return await Promise.race([
			timeout,
			(async () => {
				const registration =
					await navigator.serviceWorker.getRegistration(scope);
				if (settled) throw new ClientFailure({ code: 'service-worker' });
				if (!registration) throw new ClientFailure({ code: 'service-worker' });
				if (registration.active) return registration;
				const worker = registration.installing ?? registration.waiting;
				if (!worker) throw new ClientFailure({ code: 'service-worker' });
				await new Promise<void>((resolve, reject) => {
					const check = () => {
						if (registration.active || worker.state === 'activated') resolve();
						else if (worker.state === 'redundant')
							reject(new ClientFailure({ code: 'service-worker' }));
					};
					worker.addEventListener('statechange', check);
					stop = () => worker.removeEventListener('statechange', check);
					check();
				});
				return registration;
			})(),
		]);
	} catch {
		throw new ClientFailure({ code: 'service-worker' });
	} finally {
		settled = true;
		clearTimeout(timer);
		stop();
	}
}

export function createPushClient(options: PushClientOptions = {}): PushClient {
	let snapshot = UNKNOWN;
	const listeners = new Set<() => void>();
	const pending = new Map<Action, Promise<PushState>>();
	let tail: Promise<unknown> | null = null;
	let references = 0;
	let initialized = false;
	let detached = false;
	let postedEndpoint: string | null = null;
	let previousEndpoint: string | null = null;
	let config: Config | null = null;
	let registration: ServiceWorkerRegistration | null = null;
	const endpoint = options.endpoint ?? '/api/push';
	const scope = options.serviceWorkerScope ?? '/';

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
				signal: AbortSignal.timeout(10_000),
			});
		} catch {
			throw new ClientFailure({ code: 'network' });
		}
	}
	async function discard(response: Response): Promise<void> {
		try {
			await response.body?.cancel();
		} catch {}
	}
	async function readConfig(): Promise<Config> {
		const response = await post({ action: 'config' });
		if (!response.ok) {
			await discard(response);
			throw new ClientFailure({ code: 'server', status: response.status });
		}
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
	async function reconcile(
		force: boolean,
		allowCreate: boolean,
		raced = false,
	): Promise<PushState> {
		if (!registration || !config)
			throw new ClientFailure({ code: 'not-ready' });
		let subscription = await registration.pushManager.getSubscription();
		if (
			subscription &&
			!equalKey(subscription.options.applicationServerKey, config.publicKey)
		) {
			previousEndpoint ??= subscription.endpoint;
			if (!(await subscription.unsubscribe()))
				throw new ClientFailure({ code: 'push-service' });
			subscription = null;
			allowCreate = true;
		}
		if (!subscription && allowCreate && Notification.permission === 'granted') {
			try {
				subscription = await registration.pushManager.subscribe({
					userVisibleOnly: true,
					applicationServerKey: decodeBase64(config.publicKey),
				});
			} catch {
				throw new ClientFailure({ code: 'push-service' });
			}
		}
		if (!subscription) return setState({ status: 'unsubscribed' });
		if (!force && postedEndpoint === subscription.endpoint)
			return setState({ status: 'subscribed' });
		const response = await post({
			action: 'subscribe',
			publicKey: config.publicKey,
			subscription: subscription.toJSON(),
			...(previousEndpoint && previousEndpoint !== subscription.endpoint
				? { previousEndpoint }
				: {}),
		});
		await discard(response);
		if (response.status === 409) {
			if (raced) throw new ClientFailure({ code: 'config' });
			config = await readConfig();
			return reconcile(true, true, true);
		}
		if (!response.ok)
			throw new ClientFailure({ code: 'server', status: response.status });
		postedEndpoint = subscription.endpoint;
		previousEndpoint = null;
		return setState({ status: 'subscribed' });
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
		let permission: Promise<NotificationPermission | null>;
		try {
			permission = (
				Notification.permission === 'default'
					? Notification.requestPermission()
					: Promise.resolve(Notification.permission)
			).catch(() => null);
		} catch {
			return Promise.resolve(
				failed(new ClientFailure({ code: 'push-service' })),
			);
		}
		return run('enable', async () => {
			setState({ status: 'enabling' });
			let granted: NotificationPermission | null;
			try {
				granted = await permission;
			} catch {
				throw new ClientFailure({ code: 'push-service' });
			}
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
