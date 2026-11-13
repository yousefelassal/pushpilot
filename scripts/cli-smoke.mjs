import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createPush } from '../packages/pushpilot/dist/server/index.js';
const execute = promisify(execFile);
const cli = resolve('packages/pushpilot/dist/cli/index.js');
const directory = await mkdtemp(join(tmpdir(), 'pushpilot-cli-'));
let server;
try {
	const keys = JSON.parse(
		(await execute(process.execPath, [cli, 'keygen', '--json'])).stdout,
	);
	const env = {
		...process.env,
		VAPID_PUBLIC_KEY: keys.publicKey,
		VAPID_PRIVATE_KEY: keys.privateKey,
		VAPID_SUBJECT: 'mailto:test@example.com',
	};
	const handler = createPush({
		vapid: {
			publicKey: keys.publicKey,
			privateKey: keys.privateKey,
			subject: env.VAPID_SUBJECT,
		},
	}).handler({ onSubscribe() {}, onUnsubscribe() {} });
	server = createServer(async (incoming, outgoing) => {
		const body = [];
		for await (const chunk of incoming) body.push(chunk);
		const response = await handler(
			new Request(`http://localhost${incoming.url}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: Buffer.concat(body),
			}),
		);
		outgoing.writeHead(response.status, Object.fromEntries(response.headers));
		outgoing.end(await response.text());
	});
	await new Promise((done) => server.listen(0, '127.0.0.1', done));
	const result = await execute(
		process.execPath,
		[
			cli,
			'doctor',
			'--url',
			`http://127.0.0.1:${server.address().port}/api/push`,
			'--json',
		],
		{ env },
	);
	assert(JSON.parse(result.stdout).ok);
	assert(!result.stdout.includes(keys.privateKey));
	const path = join(directory, '.env');
	await writeFile(
		path,
		`# No shell evaluation\nexport VAPID_PUBLIC_KEY='${keys.publicKey}'\nVAPID_PRIVATE_KEY="${keys.privateKey}"\nVAPID_SUBJECT=mailto:test@example.com\n`,
	);
	const noKeys = { ...process.env };
	for (const name of ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'])
		delete noKeys[name];
	assert(
		JSON.parse(
			(
				await execute(
					process.execPath,
					[cli, 'doctor', '--env-file', path, '--json'],
					{ env: noKeys },
				)
			).stdout,
		).ok,
	);
	await assert.rejects(
		execute(process.execPath, [cli, 'doctor', '--env-file', path, '--json'], {
			env: { ...noKeys, VAPID_PRIVATE_KEY: 'SENTINEL_SECRET' },
		}),
		(error) => {
			assert.equal(error.code, 1);
			assert(!error.stdout.includes('SENTINEL_SECRET'));
			assert(!error.stderr.includes('SENTINEL_SECRET'));
			return true;
		},
	);
	await assert.rejects(
		execute(process.execPath, [cli, 'keygen', '--url', 'SECRET']),
		(error) => {
			assert.equal(error.code, 2);
			assert(!error.stderr.includes('SECRET'));
			return true;
		},
	);
	console.log(
		'PASS CLI live handler probe, env-file parsing, environment precedence, secret redaction, and usage exit codes',
	);
} finally {
	if (server) await new Promise((done) => server.close(done));
	await rm(directory, { recursive: true, force: true });
}
