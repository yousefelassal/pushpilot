import { mkdtemp, readdir, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import packageJson from '../packages/pushpilot/package.json' with { type: 'json' };

const directory = await mkdtemp(join(tmpdir(), 'pushpilot-packed-'));
try {
	execFileSync(
		'pnpm',
		['--filter', 'pushpilot', 'pack', '--pack-destination', directory],
		{ stdio: 'pipe' },
	);
	const archive = (await readdir(directory)).find((file) =>
		file.endsWith('.tgz'),
	);
	assert(archive);
	execFileSync(
		'npm',
		[
			'install',
			'--prefix',
			directory,
			'--engine-strict',
			'--ignore-scripts',
			'--no-audit',
			'--no-fund',
			join(directory, archive),
		],
		{ stdio: 'pipe' },
	);
	const installed = join(directory, 'node_modules/pushpilot');
	const env = { ...process.env, PUSHPILOT_SMOKE_PACKAGE: installed };
	execFileSync(process.execPath, [resolve('scripts/runtime-smoke.mjs')], {
		env,
		stdio: 'inherit',
	});
	if (process.env.PUSHPILOT_SMOKE_BUN === '1')
		execFileSync('bun', ['run', resolve('scripts/runtime-smoke.mjs')], {
			env,
			stdio: 'inherit',
		});
	if (process.env.PUSHPILOT_SMOKE_DENO === '1')
		execFileSync(
			'deno',
			[
				'run',
				'--allow-read',
				'--allow-env',
				resolve('scripts/runtime-smoke.mjs'),
			],
			{ env, stdio: 'inherit' },
		);
	const cli = join(installed, 'dist/cli/index.js');
	const keys = JSON.parse(
		execFileSync(process.execPath, [cli, 'keygen', '--json'], {
			encoding: 'utf8',
		}),
	);
	assert.equal(Buffer.from(keys.publicKey, 'base64url').length, 65);
	assert.equal(Buffer.from(keys.privateKey, 'base64url').length, 32);
	const doctor = JSON.parse(
		execFileSync(process.execPath, [cli, 'doctor', '--json'], {
			encoding: 'utf8',
			env: {
				...process.env,
				VAPID_PUBLIC_KEY: keys.publicKey,
				VAPID_PRIVATE_KEY: keys.privateKey,
				VAPID_SUBJECT: 'mailto:test@example.com',
			},
		}),
	);
	assert(doctor.ok);
	assert.equal(doctor.keyId, keys.keyId);
	assert(!JSON.stringify(doctor).includes(keys.privateKey));
	assert.equal(
		execFileSync(process.execPath, [cli, '--version'], {
			encoding: 'utf8',
		}).trim(),
		packageJson.version,
	);
	for (const entry of ['client', 'sw', 'react']) {
		const contents = await readFile(
			join(installed, `dist/${entry}/index.js`),
			'utf8',
		);
		assert(
			!/node:|encryptNotification|prepareKeys|privateKey/.test(contents),
			`${entry} must not contain server or Node code`,
		);
	}
	console.log(
		'PASS strict packed install, CLI keygen/doctor, and browser dependency boundaries',
	);
} finally {
	await rm(directory, { recursive: true, force: true });
}
