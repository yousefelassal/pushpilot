import { PushpilotError } from './errors.js';
import type { Json, PushNotification, SendOptions } from './types/index.js';

const DEFAULT_TTL_SECONDS = 86400;
const MAX_TTL_SECONDS = 2419200;
const URGENCIES: readonly string[] = ['very-low', 'low', 'normal', 'high'];

/** Reserves room for encryption framing and authentication overhead in a 4096-byte push message. */
const MAX_PAYLOAD_BYTES = 3993;

const TEXT_FIELDS = ['body', 'url', 'icon', 'badge', 'image', 'tag'];
const URL_FIELDS = ['url', 'icon', 'badge', 'image'];
const BOOLEAN_FIELDS = ['requireInteraction', 'silent', 'renotify'];

/** Narrows to a plain, non-array object. */
export function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPlainContainer(value: object): boolean {
	if (Array.isArray(value)) return true;
	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function isJsonValue(value: unknown, seen = new Set<object>()): value is Json {
	if (value === null || typeof value === 'string' || typeof value === 'boolean')
		return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (typeof value !== 'object' || seen.has(value)) return false;
	if (!isPlainContainer(value)) return false;

	// Tracks only the current path so shared (non-circular) references stay valid.
	seen.add(value);
	const valid = Object.values(value).every((child) => isJsonValue(child, seen));
	seen.delete(value);
	return valid;
}

function isNotificationUrl(value: string): boolean {
	try {
		const url = new URL(value, 'https://pushpilot.invalid/');
		return url.protocol === 'https:' && !url.username && !url.password;
	} catch {
		return false;
	}
}

function invalidNotification(): PushpilotError {
	return new PushpilotError(
		'invalid-notification',
		'Invalid notification fields.',
	);
}

function copyTextFields(
	value: Record<string, unknown>,
	result: Record<string, unknown>,
): void {
	for (const field of TEXT_FIELDS) {
		const item = value[field];
		if (item === undefined) continue;

		if (
			typeof item !== 'string' ||
			(URL_FIELDS.includes(field) && !isNotificationUrl(item))
		)
			throw invalidNotification();
		result[field] = item;
	}
}

function copyBooleanFields(
	value: Record<string, unknown>,
	result: Record<string, unknown>,
): void {
	for (const field of BOOLEAN_FIELDS) {
		const item = value[field];
		if (item === undefined) continue;
		if (typeof item !== 'boolean') throw invalidNotification();
		result[field] = item;
	}

	const hasTag = typeof value.tag === 'string' && value.tag.trim();
	if (value.renotify === true && !hasTag) throw invalidNotification();
}

function parseAction(action: unknown): {
	action: string;
	title: string;
	url?: string;
} {
	if (
		!isObject(action) ||
		typeof action.action !== 'string' ||
		!action.action ||
		typeof action.title !== 'string' ||
		!action.title ||
		(action.url !== undefined &&
			(typeof action.url !== 'string' || !isNotificationUrl(action.url)))
	)
		throw invalidNotification();

	return {
		action: action.action,
		title: action.title,
		...(action.url === undefined ? {} : { url: action.url }),
	};
}

/**
 * Parses untrusted notification data and copies only fields supported by
 * wire version 1. Unknown fields are dropped.
 *
 * @throws {PushpilotError} `invalid-notification` when any field is malformed.
 */
export function parseNotification(value: unknown): PushNotification {
	if (
		!isObject(value) ||
		typeof value.title !== 'string' ||
		!value.title.trim()
	)
		throw invalidNotification();

	const result: { title: string } & Record<string, unknown> = {
		title: value.title,
	};
	copyTextFields(value, result);
	copyBooleanFields(value, result);

	if (value.actions !== undefined) {
		if (!Array.isArray(value.actions)) throw invalidNotification();
		result.actions = value.actions.map(parseAction);
	}

	if (value.data !== undefined) {
		if (!isObject(value.data) || !isJsonValue(value.data))
			throw invalidNotification();
		result.data = value.data;
	}

	return result as PushNotification;
}

function validateSendOptions(ttl: number, urgency: string): void {
	if (
		!Number.isInteger(ttl) ||
		ttl < 1 ||
		ttl > MAX_TTL_SECONDS ||
		!URGENCIES.includes(urgency)
	)
		throw new PushpilotError('invalid-notification', 'Invalid TTL or urgency.');
}

function serializeNotification(
	notification: PushNotification,
): Uint8Array<ArrayBuffer> {
	try {
		return new TextEncoder().encode(
			JSON.stringify({ v: 1, ...parseNotification(notification) }),
		);
	} catch (error) {
		if (error instanceof PushpilotError) throw error;
		throw new PushpilotError(
			'invalid-notification',
			'Invalid notification JSON.',
		);
	}
}

/**
 * Encodes one shared payload for the batch and validates delivery headers
 * before network I/O.
 *
 * @throws {PushpilotError} `invalid-notification` or `payload-too-large`.
 */
export function encodePayload(
	notification: PushNotification,
	options: SendOptions = {},
): { payload: Uint8Array<ArrayBuffer>; ttl: number; urgency: string } {
	const ttl = options.ttl ?? DEFAULT_TTL_SECONDS;
	const urgency = options.urgency ?? 'normal';
	validateSendOptions(ttl, urgency);

	const payload = serializeNotification(notification);
	if (payload.byteLength > MAX_PAYLOAD_BYTES)
		throw new PushpilotError(
			'payload-too-large',
			`Notification exceeds ${MAX_PAYLOAD_BYTES} UTF-8 bytes.`,
		);

	return { payload, ttl, urgency };
}
