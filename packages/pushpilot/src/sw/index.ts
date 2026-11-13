import { isObject, parseNotification } from '../shared/wire.js';
import type { PushNotification } from '../shared/types.js';
export type { Json, PushNotification } from '../shared/types.js';

export interface HandlePushOptions {
	readonly fallback: {
		readonly title: string;
		readonly body?: string;
		readonly url?: string;
	};
	readonly icon?: string;
	readonly badge?: string;
}
interface ExtendableEvent {
	waitUntil(promise: Promise<unknown>): void;
}
interface WorkerPushEvent extends ExtendableEvent {
	data: { text(): string } | null;
}
interface WorkerClickEvent extends ExtendableEvent {
	action: string;
	notification: { close(): void; data: unknown };
}
interface WorkerClient {
	url: string;
	focus(): Promise<unknown>;
}
interface WorkerScope {
	location: { origin: string };
	registration: {
		scope: string;
		showNotification(
			title: string,
			options: NotificationOptions,
		): Promise<void>;
	};
	clients: {
		matchAll(options: {
			type: 'window';
			includeUncontrolled: boolean;
		}): Promise<readonly WorkerClient[]>;
		openWindow(url: string): Promise<unknown>;
	};
	addEventListener(
		type: 'push',
		listener: (event: WorkerPushEvent) => void,
	): void;
	addEventListener(
		type: 'notificationclick',
		listener: (event: WorkerClickEvent) => void,
	): void;
}
interface NavigationData {
	url?: string;
	actions?: readonly { action: string; url?: string }[];
	data?: unknown;
}
const installed = new WeakSet<object>();

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
	} catch {}
	return scope.registration.scope;
}
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

export function handlePush(options: HandlePushOptions): void {
	const scope = globalThis as unknown as WorkerScope;
	if (installed.has(scope))
		throw new Error('pushpilot push handlers are already installed.');
	const fallback = parseNotification(options.fallback);
	installed.add(scope);
	async function display(event: WorkerPushEvent): Promise<void> {
		let payload: PushNotification;
		try {
			const value: unknown = JSON.parse(event.data?.text() ?? 'null');
			if (!isObject(value) || value.v !== 1) throw new Error();
			payload = parseNotification(value);
		} catch {
			payload = fallback;
		}
		const { title, url, actions, data, tag, renotify, ...content } = payload;
		const displayOptions: NotificationOptions & {
			image?: string;
			actions?: readonly { action: string; title: string }[];
		} = {
			...(options.icon ? { icon: options.icon } : {}),
			...(options.badge ? { badge: options.badge } : {}),
			...content,
			...(tag !== undefined ? { tag } : {}),
			...(renotify !== undefined ? { renotify } : {}),
			...(actions
				? {
						actions: actions.map(({ action, title: actionTitle }) => ({
							action,
							title: actionTitle,
						})),
					}
				: {}),
			data: {
				url: url ?? fallback.url ?? scope.registration.scope,
				actions,
				data,
			},
		};
		try {
			await scope.registration.showNotification(title, displayOptions);
		} catch {
			await scope.registration.showNotification(fallback.title, {
				...(fallback.body ? { body: fallback.body } : {}),
				data: { url: fallback.url ?? scope.registration.scope },
			});
		}
	}
	async function click(event: WorkerClickEvent): Promise<void> {
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
	scope.addEventListener('push', (event) => {
		event.waitUntil(Promise.resolve().then(() => display(event)));
	});
	scope.addEventListener('notificationclick', (event) => {
		event.notification.close();
		event.waitUntil(Promise.resolve().then(() => click(event)));
	});
}
