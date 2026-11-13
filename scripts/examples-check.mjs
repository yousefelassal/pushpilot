import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const execute = promisify(execFile);
const keys = JSON.parse(
	(
		await execute(process.execPath, [
			'packages/pushpilot/dist/cli/index.js',
			'keygen',
			'--json',
		])
	).stdout,
);
const env = {
	...process.env,
	VAPID_PUBLIC_KEY: keys.publicKey,
	VAPID_PRIVATE_KEY: keys.privateKey,
	VAPID_SUBJECT: 'mailto:test@example.com',
	DEMO_SECRET: randomUUID(),
	PORT: '3000',
	HOST: '127.0.0.1',
	NEXT_TELEMETRY_DISABLED: '1',
	ASTRO_TELEMETRY_DISABLED: '1',
};
const frameworks = process.argv.slice(2);
for (const framework of frameworks.length
	? frameworks
	: ['hono', 'next', 'react-router', 'astro']) {
	await execute(
		'pnpm',
		['--filter', `@pushpilot/example-${framework}`, 'build'],
		{ env, maxBuffer: 4 * 1024 * 1024 },
	);
	const child = spawn(
		'pnpm',
		['--filter', `@pushpilot/example-${framework}`, 'start'],
		{ env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] },
	);
	let logs = '';
	child.stdout.on('data', (data) => (logs += data));
	child.stderr.on('data', (data) => (logs += data));
	try {
		let ready = false;
		for (let attempt = 0; attempt < 200; attempt++) {
			if (child.exitCode !== null)
				throw new Error(`${framework} exited before ready: ${logs}`);
			try {
				if ((await fetch('http://localhost:3000/')).ok) {
					ready = true;
					break;
				}
			} catch {
				// Connection refusal is expected until the example server begins listening.
			}
			await new Promise((done) => setTimeout(done, 100));
		}
		assert(ready, `${framework} did not start`);
		const response = await fetch('http://localhost:3000/api/push', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'config' }),
		});
		assert.equal(response.status, 200, framework);
		assert.equal((await response.json()).publicKey, keys.publicKey);
		const refusal = await fetch('http://localhost:3000/api/push', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({
				action: 'unsubscribe',
				endpoint: 'https://fcm.googleapis.com/test',
			}),
		});
		assert.equal(refusal.status, 401, framework);
		const allowed = await fetch('http://localhost:3000/api/push', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${env.DEMO_SECRET}`,
			},
			body: JSON.stringify({
				action: 'unsubscribe',
				endpoint: 'https://fcm.googleapis.com/test',
			}),
		});
		assert.equal(allowed.status, 204, framework);
		const report = await fetch('http://localhost:3000/api/notify', {
			method: 'POST',
			headers: {
				authorization: `Bearer ${env.DEMO_SECRET}`,
				origin: 'http://localhost:3000',
				'content-type': 'application/json',
			},
		});
		assert.equal(
			report.status,
			200,
			`${framework}: ${report.status === 200 ? '' : await report.text()} ${logs}`,
		);
		assert.deepEqual(await report.json(), { results: [] });
		console.log(
			`PASS ${framework} build, live config route, authenticated callbacks, and empty send`,
		);
	} finally {
		if (child.pid) {
			try {
				process.kill(-child.pid, 'SIGTERM');
			} catch {
				// The process group already exited, so there is nothing left to stop.
			}
		}
		await new Promise((done) =>
			child.exitCode !== null ? done() : child.once('exit', done),
		);
	}
}
