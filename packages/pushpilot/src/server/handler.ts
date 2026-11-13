import { normalizeKey } from '../shared/keys.js';
import {
	parseBrowserSubscription,
	parseEndpoint,
} from '../shared/subscription.js';
import type { CallbackResult } from '../shared/types/index.js';
import type { PreparedKeys } from '../shared/types/internal.js';
import { isObject } from '../shared/wire.js';
import type { HandlerErrorCode, HandlerInput } from './types/handler.js';

const MAX_BODY_BYTES = 16384;
const ACTIONS = ['config', 'subscribe', 'unsubscribe'];

type Body = Record<string, unknown> & { action: string };

function errorResponse(
	status: number,
	code: HandlerErrorCode,
	message: string,
): Response {
	const headers = new Headers({ 'cache-control': 'no-store' });
	if (status === 405) headers.set('allow', 'POST');
	return Response.json({ error: { code, message } }, { status, headers });
}

function callbackResponse(result: CallbackResult): Response {
	if (result === undefined)
		return new Response(null, {
			status: 204,
			headers: { 'cache-control': 'no-store' },
		});

	// Callbacks may only reject; success is signalled by returning nothing.
	if (
		result instanceof Response &&
		result.status >= 400 &&
		result.status <= 599
	)
		return result;

	return errorResponse(
		500,
		'internal',
		'The push handler could not complete the request.',
	);
}

/** Reads at most 16 KiB, enforcing the limit even when Content-Length is absent or false. */
async function readBody(request: Request): Promise<unknown> {
	if (request.bodyUsed || !request.body) throw new Error('invalid-request');

	const reader = request.body.getReader();
	const chunks: Uint8Array[] = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;

			size += value.byteLength;
			if (size > MAX_BODY_BYTES) {
				void reader.cancel().catch(() => {});
				throw new Error('body-too-large');
			}
			chunks.push(value);
		}
	} finally {
		reader.releaseLock();
	}

	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

/** Returns an error response for requests that fail method, origin, or media-type checks. */
function checkRequestHeaders(request: Request): Response | null {
	if (request.method !== 'POST')
		return errorResponse(405, 'method-not-allowed', 'Use POST.');

	const origin = request.headers.get('origin');
	if (origin !== null && origin !== new URL(request.url).origin)
		return errorResponse(
			403,
			'forbidden-origin',
			'The request origin is not allowed.',
		);

	const contentType = request.headers
		.get('content-type')
		?.split(';', 1)[0]
		?.trim()
		.toLowerCase();
	if (contentType !== 'application/json')
		return errorResponse(
			415,
			'unsupported-media-type',
			'Use application/json.',
		);

	return null;
}

async function parseBody(request: Request): Promise<Body | Response> {
	let body: unknown;
	try {
		body = await readBody(request);
	} catch (cause) {
		if (cause instanceof Error && cause.message === 'body-too-large')
			return errorResponse(
				413,
				'body-too-large',
				'The request body exceeds 16 KiB.',
			);
		return errorResponse(
			400,
			'invalid-request',
			'The request must contain valid JSON.',
		);
	}

	if (
		!isObject(body) ||
		typeof body.action !== 'string' ||
		!ACTIONS.includes(body.action)
	)
		return errorResponse(400, 'invalid-request', 'The action is invalid.');
	return body as Body;
}

async function handleUnsubscribe(
	input: HandlerInput,
	request: Request,
	body: Body,
): Promise<Response> {
	let endpoint: string;
	try {
		endpoint = parseEndpoint(body.endpoint);
	} catch {
		return errorResponse(
			400,
			'invalid-subscription',
			'The endpoint is invalid.',
		);
	}
	return callbackResponse(
		await input.callbacks.onUnsubscribe({ request, endpoint }),
	);
}

function handleConfig(keys: PreparedKeys): Response {
	return Response.json(
		{ publicKey: keys.current.publicKey, keyId: keys.current.keyId },
		{ headers: { 'cache-control': 'no-store' } },
	);
}

async function handleSubscribe(
	input: HandlerInput,
	request: Request,
	body: Body,
	keys: PreparedKeys,
): Promise<Response> {
	let submittedPublicKey: string;
	try {
		submittedPublicKey = normalizeKey(body.publicKey, 65, 'publicKey');
	} catch {
		return errorResponse(400, 'invalid-request', 'The public key is invalid.');
	}
	if (submittedPublicKey !== keys.current.publicKey)
		return errorResponse(
			409,
			'stale-key',
			'Refresh the push configuration and try again.',
		);

	let subscription;
	let previousEndpoint: string | null = null;
	try {
		subscription = await parseBrowserSubscription(
			body.subscription,
			keys.current.keyId,
			input.matchHost,
		);
		if (body.previousEndpoint !== undefined)
			previousEndpoint = parseEndpoint(body.previousEndpoint);
		if (previousEndpoint === subscription.endpoint)
			throw new Error('invalid previousEndpoint');
	} catch {
		return errorResponse(
			400,
			'invalid-subscription',
			'The subscription is invalid.',
		);
	}

	return callbackResponse(
		await input.callbacks.onSubscribe({
			request,
			subscription,
			previousEndpoint,
		}),
	);
}

/**
 * Builds a POST-only Request/Response handler. Application callback
 * exceptions propagate. Callbacks receive the original request after its
 * body has been consumed.
 */
export function createHandler(
	input: HandlerInput,
): (request: Request) => Promise<Response> {
	return async (request) => {
		const rejected = checkRequestHeaders(request);
		if (rejected) return rejected;

		const body = await parseBody(request);
		if (body instanceof Response) return body;

		// Removal must still work if an old key or push-service host has been retired.
		if (body.action === 'unsubscribe')
			return handleUnsubscribe(input, request, body);

		let keys: PreparedKeys;
		try {
			keys = await input.getKeys();
		} catch {
			return errorResponse(
				500,
				'internal',
				'The push configuration is invalid.',
			);
		}

		if (body.action === 'config') return handleConfig(keys);
		return handleSubscribe(input, request, body, keys);
	};
}
