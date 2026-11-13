import { Miniflare } from 'miniflare';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const directory = await mkdtemp(join(tmpdir(), 'pushpilot-workerd-'));
let worker;
try {
	const entry = `import { createPush } from './packages/pushpilot/dist/server/index.js';
import { createPushClient } from './packages/pushpilot/dist/client/index.js';
import { verifyCrypto } from './scripts/crypto-check.mjs';
export default { async fetch() { return new Response(await verifyCrypto(createPush, createPushClient)); } };`;
	const scriptPath = join(directory, 'worker.mjs');
	await build({
		stdin: { contents: entry, resolveDir: resolve('.') },
		outfile: scriptPath,
		bundle: true,
		format: 'esm',
		platform: 'browser',
		target: 'es2022',
	});
	worker = new Miniflare({
		modules: true,
		modulesRoot: directory,
		rootPath: directory,
		scriptPath,
		compatibilityDate: '2025-11-13',
	});
	const response = await worker.dispatchFetch('https://smoke.example/');
	assert.equal(response.status, 200);
	assert.match(await response.text(), /independent decryption/);
	console.log(
		'PASS workerd encryption, independent decryption, VAPID verification, and SSR import',
	);
} finally {
	await worker?.dispose();
	await rm(directory, { recursive: true, force: true });
}
