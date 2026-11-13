import type { PushNotification } from '../shared/types/index.js';
import { isObject, parseNotification } from '../shared/wire.js';
import type { HandlePushOptions } from './types/index.js';
import type {
	DisplayOptions,
	NavigationData,
	WorkerClickEvent,
	WorkerPushEvent,
	WorkerScope,
} from './types/worker.js';

export type { HandlePushOptions } from './types/index.js';
export type { Json, PushNotification } from '../shared/types/index.js';

const installed = new WeakSet<object>();

/** Resolves against the worker scope and falls back to it for anything off-origin or malformed. */
function safeUrl(value: unknown, scope: WorkerScope): string {
	try {
		const url = new URL(
			typeof value === 'string' ? value : scope.registration.scope,
			scope.registration.scope,
		);
		if (
			(url.protocol === 'https:' || url.protocol === 'http:') &&
			url.origin === scope.location.origin &&
			!url.username &&
			!url.password
		)
			return url.href;
	} catch {
		// A malformed URL is handled the same as an off-origin one: open the scope root.
	}
	return scope.registration.scope;
}

/** Extracts only the click-routing fields from stored notification data. */
function navigation(value: unknown): NavigationData {
	if (!isObject(value)) return {};

	const result: NavigationData = {};
	if (typeof value.url === 'string') result.url = value.url;
	if (Array.isArray(value.actions)) {
		result.actions = value.actions.flatMap((action: unknown) =>
			isObject(action) &&
			typeof action.action === 'string' &&
			typeof action.url === 'string'
				? [{ action: action.action, url: action.url }]
				: [],
		);
	}
	return result;
}

/** Uses the payload when it is a valid version 1 message, otherwise the fallback. */
function readPayload(
	event: WorkerPushEvent,
	fallback: PushNotification,
): PushNotification {
	try {
		const value: unknown = JSON.parse(event.data?.text() ?? 'null');
		if (!isObject(value) || value.v !== 1) throw new Error();
		return parseNotification(value);
	} catch {
		return fallback;
	}
}

function buildDisplayOptions(
	payload: PushNotification,
	options: HandlePushOptions,
	fallback: PushNotification,
	scope: WorkerScope,
): DisplayOptions {
	// `title` is passed to showNotification separately, so keep it out of the options.
	const {
		title: _title,
		url,
		actions,
		data,
		tag,
		renotify,
		...content
	} = payload;
	return {
		...(options.icon ? { icon: options.icon } : {}),
		...(options.badge ? { badge: options.badge } : {}),
		...content,
		...(tag !== undefined ? { tag } : {}),
		...(renotify !== undefined ? { renotify } : {}),
		...(actions
			? {
					actions: actions.map(({ action, title }) => ({ action, title })),
				}
			: {}),
		// Click routing data is kept in notification.data because the click handler cannot see the payload.
		data: {
			url: url ?? fallback.url ?? scope.registration.scope,
			actions,
			data,
		},
	};
}

async function display(
	event: WorkerPushEvent,
	options: HandlePushOptions,
	fallback: PushNotification,
	scope: WorkerScope,
): Promise<void> {
	const payload = readPayload(event, fallback);
	try {
		await scope.registration.showNotification(
			payload.title,
			buildDisplayOptions(payload, options, fallback, scope),
		);
	} catch {
		// Browsers penalize pushes that show nothing, so a rejected payload degrades to the fallback.
		await scope.registration.showNotification(fallback.title, {
			...(fallback.body ? { body: fallback.body } : {}),
			data: { url: fallback.url ?? scope.registration.scope },
		});
	}
}

async function click(
	event: WorkerClickEvent,
	fallback: PushNotification,
	scope: WorkerScope,
): Promise<void> {
	const data = navigation(event.notification.data);
	const action = data.actions?.find(
		(candidate) => candidate.action === event.action,
	);
	const target = safeUrl(action?.url ?? data.url ?? fallback.url, scope);

	const clients = await scope.clients.matchAll({
		type: 'window',
		includeUncontrolled: true,
	});
	const existing = clients.find((client) => client.url === target);
	if (existing) await existing.focus();
	else await scope.clients.openWindow(target);
}

/**
 * Installs `push` and `notificationclick` listeners in a service worker.
 * Call it once, synchronously, at the top level of the worker script.
 *
 * Payloads from `push.send` are validated and shown. Anything unreadable
 * shows `options.fallback` instead. Clicks focus an existing tab at the
 * target URL or open a new one. Targets outside the worker's origin open the
 * scope root.
 *
 * @param options Fallback notification and default icon and badge.
 * @throws {Error} If called twice in the same worker.
 * @throws {PushpilotError} `invalid-notification` if `options.fallback` is invalid.
 *
 * @example
 * ```ts
 * // public/sw.js, bundled for the browser
 * import { handlePush } from 'pushpilot/sw';
 *
 * handlePush({
 *   fallback: { title: 'New notification', url: '/' },
 *   icon: '/icon-192.png',
 * });
 * ```
 */
export function handlePush(options: HandlePushOptions): void {
	const scope = globalThis as unknown as WorkerScope;
	if (installed.has(scope))
		throw new Error('pushpilot push handlers are already installed.');

	const fallback = parseNotification(options.fallback);
	installed.add(scope);

	scope.addEventListener('push', (event) => {
		event.waitUntil(
			Promise.resolve().then(() => display(event, options, fallback, scope)),
		);
	});
	scope.addEventListener('notificationclick', (event) => {
		event.notification.close();
		event.waitUntil(
			Promise.resolve().then(() => click(event, fallback, scope)),
		);
	});
}
