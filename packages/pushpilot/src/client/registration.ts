import { ClientFailure } from './failure.js';

const ACTIVATION_TIMEOUT_MS = 10_000;

function workerFailure(): ClientFailure {
	return new ClientFailure({ code: 'service-worker' });
}

/** Resolves once the worker has activated, or rejects if it becomes redundant. */
function waitForActivation(
	registration: ServiceWorkerRegistration,
	worker: ServiceWorker,
	onCleanup: (stop: () => void) => void,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const check = () => {
			if (registration.active || worker.state === 'activated') resolve();
			else if (worker.state === 'redundant') reject(workerFailure());
		};
		worker.addEventListener('statechange', check);
		onCleanup(() => worker.removeEventListener('statechange', check));
		check();
	});
}

/** Waits up to 10 seconds for an activated service worker in `scope`. */
export async function activeRegistration(
	scope: string,
): Promise<ServiceWorkerRegistration> {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let stop = () => {};
	let settled = false;
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => reject(workerFailure()), ACTIVATION_TIMEOUT_MS);
	});

	async function find(): Promise<ServiceWorkerRegistration> {
		const registration = await navigator.serviceWorker.getRegistration(scope);
		// The timeout already rejected; do not attach listeners that nothing will remove.
		if (settled || !registration) throw workerFailure();
		if (registration.active) return registration;

		const worker = registration.installing ?? registration.waiting;
		if (!worker) throw workerFailure();
		await waitForActivation(registration, worker, (cleanup) => {
			stop = cleanup;
		});
		return registration;
	}

	try {
		return await Promise.race([timeout, find()]);
	} catch {
		throw workerFailure();
	} finally {
		settled = true;
		clearTimeout(timer);
		stop();
	}
}
