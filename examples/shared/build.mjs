import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const out = resolve(process.cwd(), 'public');
await mkdir(out, { recursive: true });
await build({
	entryPoints: [new URL('./browser.ts', import.meta.url).pathname],
	bundle: true,
	format: 'esm',
	target: 'es2022',
	outfile: resolve(out, 'browser.js'),
});
await build({
	entryPoints: [new URL('./sw.ts', import.meta.url).pathname],
	bundle: true,
	format: 'iife',
	target: 'es2022',
	outfile: resolve(out, 'sw.js'),
});
await writeFile(
	resolve(out, 'index.html'),
	`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>pushpilot local example</title><link rel="manifest" href="/manifest.webmanifest"></head><body><main><h1>pushpilot local example</h1><p>Local demo only. Subscriptions disappear when the server restarts.</p><label>Demo password <input id="password" type="password" autocomplete="off"></label><p id="status">Starting</p><button id="enable" disabled>Enable notifications</button><button id="disable" disabled>Disable notifications</button><button id="send" disabled>Send test notification</button><script type="module" src="/browser.js"></script></main></body></html>`,
);
await writeFile(
	resolve(out, 'manifest.webmanifest'),
	JSON.stringify({
		name: 'pushpilot example',
		short_name: 'pushpilot',
		start_url: '/',
		display: 'standalone',
		icons: [],
	}),
);
