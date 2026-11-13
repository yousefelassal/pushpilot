import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium, firefox } from '@playwright/test';

const key = await crypto.subtle.generateKey(
	{ name: 'ECDSA', namedCurve: 'P-256' },
	true,
	['sign', 'verify'],
);
const raw = new Uint8Array(await crypto.subtle.exportKey('raw', key.publicKey));
const publicKey = Buffer.from(raw).toString('base64url');
const keyId = Buffer.from(await crypto.subtle.digest('SHA-256', raw))
	.subarray(0, 8)
	.toString('hex');
const client = await build({
	entryPoints: ['packages/pushpilot/dist/client/index.js'],
	bundle: true,
	format: 'esm',
	write: false,
});
const worker = await build({
	stdin: {
		contents: `import {handlePush} from './packages/pushpilot/dist/sw/index.js';handlePush({fallback:{title:'Smoke fallback'}});`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: 'esm',
	write: false,
});
let posts = 0;
const server = createServer((request, response) => {
	if (request.url === '/api/push') {
		posts++;
		response.writeHead(200, {
			'content-type': 'application/json',
			'cache-control': 'no-store',
		});
		response.end(JSON.stringify({ publicKey, keyId }));
	} else if (request.url === '/client.js' || request.url === '/sw.js') {
		response.writeHead(200, { 'content-type': 'text/javascript' });
		response.end(
			(request.url === '/client.js' ? client : worker).outputFiles[0].contents,
		);
	} else {
		response.writeHead(200, { 'content-type': 'text/html' });
		response.end(
			`<script type="module">import {createPushClient} from '/client.js';await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;window.client=createPushClient();window.stop=window.client.start();</script>`,
		);
	}
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
const origin = `http://127.0.0.1:${address.port}`;
try {
	for (const [name, engine] of [
		['chromium', chromium],
		['firefox', firefox],
	]) {
		const browser = await engine.launch({ headless: true });
		try {
			const context = await browser.newContext({
				permissions: ['notifications'],
			});
			const page = await context.newPage();
			page.on('pageerror', (error) =>
				console.error('Browser page error:', error.message),
			);
			page.on('console', (message) => {
				if (message.type() === 'error')
					console.error('Browser console:', message.text());
			});
			await page.goto(origin);
			await page.waitForFunction(
				() => window.client && window.client.getSnapshot().status !== 'unknown',
			);
			const configuration = await page.evaluate(async () =>
				(
					await fetch('/api/push', {
						method: 'POST',
						headers: { 'content-type': 'application/json' },
						body: JSON.stringify({ action: 'config' }),
					})
				).json(),
			);
			assert.equal(configuration.publicKey, publicKey);
			const expectedState = await page.evaluate(() =>
				Notification.permission === 'denied' ? 'denied' : 'unsubscribed',
			);
			assert.equal(
				await page.evaluate(() => window.client.getSnapshot().status),
				expectedState,
			);
			assert.equal(
				await page.evaluate(
					async () =>
						!!(await navigator.serviceWorker.getRegistration('/')).active,
				),
				true,
			);
			assert.equal(
				await page.evaluate(() => window.client.getServerSnapshot().status),
				'unknown',
			);
			if (name === 'chromium') {
				const protocol = await context.newCDPSession(page);
				const registrationId = await new Promise((resolve, reject) => {
					const timeout = setTimeout(
						() => reject(new Error('No service-worker registration event')),
						10000,
					);
					protocol.on(
						'ServiceWorker.workerRegistrationUpdated',
						({ registrations }) => {
							const registration = registrations.find(
								(item) => item.scopeURL === `${origin}/` && !item.isDeleted,
							);
							if (registration) {
								clearTimeout(timeout);
								resolve(registration.registrationId);
							}
						},
					);
					void protocol.send('ServiceWorker.enable').catch(reject);
				});
				await protocol.send('ServiceWorker.deliverPushMessage', {
					origin,
					registrationId,
					data: '{bad-json',
				});
				await page.waitForFunction(async () =>
					(
						await (
							await navigator.serviceWorker.getRegistration('/')
						).getNotifications()
					).some((notification) => notification.title === 'Smoke fallback'),
				);
				await protocol.send('ServiceWorker.deliverPushMessage', {
					origin,
					registrationId,
					data: JSON.stringify({
						v: 1,
						title: 'Real worker push',
						tag: 'smoke',
					}),
				});
				await page.waitForFunction(async () =>
					(
						await (
							await navigator.serviceWorker.getRegistration('/')
						).getNotifications()
					).some((notification) => notification.title === 'Real worker push'),
				);
			}
			await page.evaluate(() => {
				window.stop();
				window.stop = window.client.start();
			});
			await page.waitForTimeout(100);
			assert.equal(
				await page.evaluate(() => window.client.getSnapshot().status),
				expectedState,
			);
			console.log(
				`PASS ${name} actual service-worker registration, activation, client state ${expectedState}, and remount${name === 'chromium' ? ', push and malformed-payload notification display' : ''}`,
			);
			await context.close();
		} finally {
			await browser.close();
		}
	}
	assert(posts >= 2);
} finally {
	await new Promise((resolve) => server.close(resolve));
}
