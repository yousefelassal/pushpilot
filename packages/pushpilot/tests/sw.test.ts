import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { handlePush } from '../src/sw/index.js';
let listeners: Map<string, (event: unknown) => void>;
let show: ReturnType<typeof vi.fn>;
let open: ReturnType<typeof vi.fn>;
let focus: ReturnType<typeof vi.fn>;
let matches: Array<{ url: string; focus: () => Promise<unknown> }>;
let install: typeof handlePush;

beforeEach(async () => {
	vi.resetModules();
	listeners = new Map();
	show = vi.fn(async () => {});
	open = vi.fn(async () => {});
	focus = vi.fn(async () => {});
	matches = [];
	vi.stubGlobal('location', { origin: 'https://app.test' });
	vi.stubGlobal('registration', {
		scope: 'https://app.test/app/',
		showNotification: show,
	});
	vi.stubGlobal('clients', { matchAll: async () => matches, openWindow: open });
	vi.stubGlobal(
		'addEventListener',
		(name: string, listener: (event: unknown) => void) =>
			listeners.set(name, listener),
	);
	install = (await import('../src/sw/index.js')).handlePush;
});
afterEach(() => vi.unstubAllGlobals());

async function push(text: string | null) {
	let promise: Promise<unknown> | undefined;
	const waitUntil = vi.fn((next: Promise<unknown>) => {
		promise = next;
	});
	listeners.get('push')?.({
		data: text === null ? null : { text: () => text },
		waitUntil,
	});
	expect(waitUntil).toHaveBeenCalledTimes(1);
	expect(show).not.toHaveBeenCalled();
	await promise;
}
async function click(data: unknown, action = '') {
	let promise: Promise<unknown> | undefined;
	const close = vi.fn();
	const waitUntil = vi.fn((next: Promise<unknown>) => {
		promise = next;
	});
	listeners.get('notificationclick')?.({
		action,
		notification: { data, close },
		waitUntil,
	});
	expect(close).toHaveBeenCalledTimes(1);
	expect(waitUntil).toHaveBeenCalledTimes(1);
	await promise;
}

it.each([
	null,
	'',
	'bad json',
	'{"v":2,"title":"Wrong version"}',
	'{"v":1,"renotify":true}',
])(
	'shows fallback for invalid payload %s with synchronous waitUntil',
	async (payload) => {
		install({ fallback: { title: 'Fallback', body: 'Open the app' } });
		await push(payload);
		expect(show).toHaveBeenCalledWith(
			'Fallback',
			expect.objectContaining({ body: 'Open the app' }),
		);
	},
);
it('keeps application data and falls back once after rich display fails', async () => {
	install({ fallback: { title: 'Fallback' } });
	show.mockRejectedValueOnce(new Error('Unsupported notification option'));
	await push('{"v":1,"title":"Hello","data":{"message":42},"url":"/inbox"}');
	expect(show).toHaveBeenNthCalledWith(
		1,
		'Hello',
		expect.objectContaining({
			data: expect.objectContaining({ data: { message: 42 } }),
		}),
	);
	expect(show).toHaveBeenNthCalledWith(
		2,
		'Fallback',
		expect.objectContaining({ data: { url: 'https://app.test/app/' } }),
	);
});
it('refuses duplicate handler installation', () => {
	install({ fallback: { title: 'Fallback' } });
	expect(() => install({ fallback: { title: 'Fallback' } })).toThrow(
		'already installed',
	);
});
it('focuses only a matching URL and does not navigate unrelated clients', async () => {
	install({ fallback: { title: 'Fallback' } });
	matches = [{ url: 'https://app.test/inbox', focus }];
	await click({ url: '/inbox' });
	expect(focus).toHaveBeenCalledTimes(1);
	expect(open).not.toHaveBeenCalled();
});
it.each([
	'https://outside.test/',
	'javascript:alert(1)',
	'https://user:password@app.test/inbox',
])('rejects unsafe click target %s', async (url) => {
	install({ fallback: { title: 'Fallback' } });
	await click({ url });
	expect(open).toHaveBeenCalledWith('https://app.test/app/');
});
it('uses an action URL and opens a new window when no exact tab exists', async () => {
	install({ fallback: { title: 'Fallback' } });
	matches = [{ url: 'https://app.test/edit', focus }];
	await click(
		{ url: '/inbox', actions: [{ action: 'view', url: '/message/1' }] },
		'view',
	);
	expect(open).toHaveBeenCalledWith('https://app.test/message/1');
	expect(focus).not.toHaveBeenCalled();
});
