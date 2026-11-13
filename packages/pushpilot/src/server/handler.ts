import type { prepareKeys } from '../shared/keys.js';
import { normalizeKey } from '../shared/keys.js';
import {
	parseBrowserSubscription,
	parseEndpoint,
} from '../shared/subscription.js';
import { isObject } from '../shared/wire.js';
import type { CallbackResult, PushCallbacks } from '../shared/types.js';

interface HandlerInput {
	callbacks: PushCallbacks;
	getKeys: () => ReturnType<typeof prepareKeys>;
	matchHost: (host: string) => boolean;
}

type ErrorCode =
	| 'invalid-request'
	| 'invalid-subscription'
	| 'stale-key'
	| 'body-too-large'
	| 'unsupported-media-type'
	| 'method-not-allowed'
	| 'forbidden-origin'
	| 'internal';

function error(status: number, code: ErrorCode, message: string): Response {
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
	if (
		result instanceof Response &&
		result.status >= 400 &&
		result.status <= 599
	)
		return result;
	return error(
		500,
		'internal',
		'The push handler could not complete the request.',
	);
}

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
			if (size > 16384) {
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

export function createHandler({
	callbacks,
	getKeys,
	matchHost,
}: HandlerInput): (request: Request) => Promise<Response> {
	return async (request) => {
		if (request.method !== 'POST')
			return error(405, 'method-not-allowed', 'Use POST.');
		const origin = request.headers.get('origin');
		if (origin !== null && origin !== new URL(request.url).origin)
			return error(
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
			return error(415, 'unsupported-media-type', 'Use application/json.');
		let body: unknown;
		try {
			body = await readBody(request);
		} catch (cause) {
			if (cause instanceof Error && cause.message === 'body-too-large')
				return error(413, 'body-too-large', 'The request body exceeds 16 KiB.');
			return error(
				400,
				'invalid-request',
				'The request must contain valid JSON.',
			);
		}
		if (
			!isObject(body) ||
			typeof body.action !== 'string' ||
			!['config', 'subscribe', 'unsubscribe'].includes(body.action)
		)
			return error(400, 'invalid-request', 'The action is invalid.');
		if (body.action === 'unsubscribe') {
			let endpoint: string;
			try {
				endpoint = parseEndpoint(body.endpoint);
			} catch {
				return error(400, 'invalid-subscription', 'The endpoint is invalid.');
			}
			return callbackResponse(
				await callbacks.onUnsubscribe({ request, endpoint }),
			);
		}
		let keys: Awaited<ReturnType<typeof prepareKeys>>;
		try {
			keys = await getKeys();
		} catch {
			return error(500, 'internal', 'The push configuration is invalid.');
		}
		if (body.action === 'config')
			return Response.json(
				{ publicKey: keys.current.publicKey, keyId: keys.current.keyId },
				{ headers: { 'cache-control': 'no-store' } },
			);
		let submittedPublicKey: string;
		try {
			submittedPublicKey = normalizeKey(body.publicKey, 65, 'publicKey');
		} catch {
			return error(400, 'invalid-request', 'The public key is invalid.');
		}
		if (submittedPublicKey !== keys.current.publicKey)
			return error(
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
				matchHost,
			);
			if (body.previousEndpoint !== undefined)
				previousEndpoint = parseEndpoint(body.previousEndpoint);
			if (previousEndpoint === subscription.endpoint)
				throw new Error('invalid previousEndpoint');
		} catch {
			return error(400, 'invalid-subscription', 'The subscription is invalid.');
		}
		return callbackResponse(
			await callbacks.onSubscribe({ request, subscription, previousEndpoint }),
		);
	};
}
