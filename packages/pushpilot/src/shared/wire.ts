import {
	PushpilotError,
	type PushNotification,
	type Json,
	type SendOptions,
} from './types.js';

export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(value: unknown, seen = new Set<object>()): value is Json {
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object' || seen.has(value)) return false;
	if (
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) !== Object.prototype &&
		Object.getPrototypeOf(value) !== null
	)
		return false;
	seen.add(value);
	const valid = Object.values(value).every((child) => json(child, seen));
	seen.delete(value);
	return valid;
}

function validUrl(value: string): boolean {
	try {
		const url = new URL(value, 'https://pushpilot.invalid/');
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}

export function parseNotification(value: unknown): PushNotification {
	const invalid = () =>
		new PushpilotError('invalid-notification', 'Invalid notification fields.');
	if (
		!isObject(value) ||
		typeof value.title !== 'string' ||
		!value.title.trim()
	)
		throw invalid();
	const result: { title: string } & Record<string, unknown> = {
		title: value.title,
	};
	for (const field of ['body', 'url', 'icon', 'badge', 'image', 'tag']) {
		const item = value[field];
		if (item === undefined) continue;
		if (
			typeof item !== 'string' ||
			(['url', 'icon', 'badge', 'image'].includes(field) && !validUrl(item))
		)
			throw invalid();
		result[field] = item;
	}
	for (const field of ['requireInteraction', 'silent', 'renotify']) {
		const item = value[field];
		if (item === undefined) continue;
		if (typeof item !== 'boolean') throw invalid();
		result[field] = item;
	}
	if (
		value.renotify === true &&
		(typeof value.tag !== 'string' || !value.tag.trim())
	)
		throw invalid();
	if (value.actions !== undefined) {
		if (!Array.isArray(value.actions)) throw invalid();
		result.actions = value.actions.map((action: unknown) => {
			if (
				!isObject(action) ||
				typeof action.action !== 'string' ||
				!action.action ||
				typeof action.title !== 'string' ||
				!action.title ||
				(action.url !== undefined &&
					(typeof action.url !== 'string' || !validUrl(action.url)))
			)
				throw invalid();
			return {
				action: action.action,
				title: action.title,
				...(action.url === undefined ? {} : { url: action.url }),
			};
		});
	}
	if (value.data !== undefined) {
		if (!isObject(value.data) || !json(value.data)) throw invalid();
		result.data = value.data;
	}
	return result as PushNotification;
}

export function encodePayload(
	notification: PushNotification,
	options: SendOptions = {},
): { payload: Uint8Array<ArrayBuffer>; ttl: number; urgency: string } {
	const ttl = options.ttl ?? 86400;
	const urgency = options.urgency ?? 'normal';
	if (
		!Number.isInteger(ttl) ||
		ttl < 1 ||
		ttl > 2419200 ||
		!['very-low', 'low', 'normal', 'high'].includes(urgency)
	)
		throw new PushpilotError('invalid-notification', 'Invalid TTL or urgency.');
	let payload: Uint8Array<ArrayBuffer>;
	try {
		payload = new TextEncoder().encode(
			JSON.stringify({ v: 1, ...parseNotification(notification) }),
		);
	} catch (error) {
		if (error instanceof PushpilotError) throw error;
		throw new PushpilotError(
			'invalid-notification',
			'Invalid notification JSON.',
		);
	}
	if (payload.byteLength > 3993)
		throw new PushpilotError(
			'payload-too-large',
			'Notification exceeds 3993 UTF-8 bytes.',
		);
	return { payload, ttl, urgency };
}
