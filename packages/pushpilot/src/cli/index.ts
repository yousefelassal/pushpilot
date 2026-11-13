#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
	prepareKeys,
	encodeBase64,
	keyId,
	normalizeKey,
} from '../shared/keys.js';
import { isObject } from '../shared/wire.js';

interface Check {
	name: string;
	ok: boolean;
	message: string;
}

async function generate(): Promise<{
	publicKey: string;
	privateKey: string;
	keyId: string;
}> {
	const pair = await crypto.subtle.generateKey(
		{ name: 'ECDSA', namedCurve: 'P-256' },
		true,
		['sign', 'verify'],
	);
	const publicKey = encodeBase64(
		new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)),
	);
	const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
	if (!jwk.d) throw new Error('Key export failed');
	return { publicKey, privateKey: jwk.d, keyId: await keyId(publicKey) };
}

function parseEnv(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const match =
			/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match?.[1] || match[2] === undefined) continue;
		const value = match[2];
		result[match[1]] =
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
				? value.slice(1, -1)
				: value.replace(/\s+#.*$/, '');
	}
	return result;
}

async function doctor(flags: Map<string, string | true>): Promise<void> {
	const file = flags.get('--env-file');
	const defaults =
		typeof file === 'string' ? parseEnv(await readFile(file, 'utf8')) : {};
	const env = {
		...defaults,
		...Object.fromEntries(
			Object.entries(process.env).filter((entry) => entry[1] !== undefined),
		),
	};
	const checks: Check[] = [];
	let fingerprint: string | null = null;
	let publicKey: string | undefined;
	try {
		publicKey = normalizeKey(env.VAPID_PUBLIC_KEY, 65, 'public key');
		fingerprint = await keyId(publicKey);
		checks.push({
			name: 'public-key',
			ok: true,
			message: 'Public key has valid encoding and length.',
		});
	} catch {
		checks.push({
			name: 'public-key',
			ok: false,
			message: 'Set VAPID_PUBLIC_KEY from pushpilot keygen.',
		});
	}
	try {
		normalizeKey(env.VAPID_PRIVATE_KEY, 32, 'private key');
		checks.push({
			name: 'private-key',
			ok: true,
			message: 'Private key has valid encoding and length.',
		});
	} catch {
		checks.push({
			name: 'private-key',
			ok: false,
			message: 'Set VAPID_PRIVATE_KEY from pushpilot keygen.',
		});
	}
	try {
		await prepareKeys({
			publicKey: env.VAPID_PUBLIC_KEY,
			privateKey: env.VAPID_PRIVATE_KEY,
			subject: env.VAPID_SUBJECT,
		});
		checks.push({
			name: 'vapid',
			ok: true,
			message: 'Subject and key pair verified.',
		});
	} catch {
		checks.push({
			name: 'vapid',
			ok: false,
			message:
				'Use a valid mailto or HTTPS subject and matching keys. Run pushpilot keygen for a new pair.',
		});
	}
	const probe = flags.get('--url');
	if (typeof probe === 'string') {
		try {
			const url = new URL(probe);
			if (
				(url.protocol !== 'https:' &&
					!(
						url.protocol === 'http:' &&
						['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
					)) ||
				url.username ||
				url.password ||
				url.hash
			)
				throw new Error();
			const response = await fetch(url, {
				method: 'POST',
				redirect: 'manual',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'config' }),
				signal: AbortSignal.timeout(10000),
			});
			let size = 0;
			const parts: Uint8Array[] = [];
			const reader = response.body?.getReader();
			try {
				if (reader)
					for (;;) {
						const next = await reader.read();
						if (next.done) break;
						size += next.value.length;
						if (size > 16384) throw new Error();
						parts.push(next.value);
					}
			} finally {
				if (reader) {
					try {
						await reader.cancel();
					} finally {
						reader.releaseLock();
					}
				}
			}
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const part of parts) {
				bytes.set(part, offset);
				offset += part.length;
			}
			const body: unknown = JSON.parse(new TextDecoder().decode(bytes));
			if (
				response.status !== 200 ||
				!response.headers.get('content-type')?.includes('application/json') ||
				!response.headers.get('cache-control')?.includes('no-store') ||
				!isObject(body) ||
				body.publicKey !== publicKey ||
				body.keyId !== fingerprint
			)
				throw new Error();
			checks.push({
				name: 'handler',
				ok: true,
				message: 'Handler configuration matches and is not cached.',
			});
		} catch {
			checks.push({
				name: 'handler',
				ok: false,
				message:
					'Check the handler URL, keys, JSON response, and no-store header.',
			});
		}
	}
	const ok = checks.every((check) => check.ok);
	if (flags.has('--json'))
		console.log(JSON.stringify({ ok, checks, keyId: fingerprint }));
	else {
		for (const check of checks)
			console.log(
				`${check.ok ? 'ok' : 'fail'} ${check.name}: ${check.message}`,
			);
		if (fingerprint) console.log(`keyId: ${fingerprint}`);
	}
	process.exitCode = ok ? 0 : 1;
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	if (command === '--version' && !args.length) {
		console.log('0.1.0');
		return;
	}
	if (command === '--help' && !args.length) {
		console.log(
			'pushpilot keygen [--json]\npushpilot doctor [--env-file <path>] [--url <handler-url>] [--json]',
		);
		return;
	}
	const flags = new Map<string, string | true>();
	if (command !== 'keygen' && command !== 'doctor') {
		console.error('Use pushpilot --help.');
		process.exitCode = 2;
		return;
	}
	for (let i = 0; i < args.length; i++) {
		const flag = args[i];
		if (flag === '--json' && !flags.has(flag)) flags.set(flag, true);
		else if (
			command === 'doctor' &&
			(flag === '--env-file' || flag === '--url') &&
			!flags.has(flag) &&
			args[i + 1] &&
			!args[i + 1]!.startsWith('--')
		)
			flags.set(flag, args[++i]!);
		else {
			console.error('Invalid arguments. Use pushpilot --help.');
			process.exitCode = 2;
			return;
		}
	}
	if (command === 'doctor') await doctor(flags);
	else {
		const keys = await generate();
		console.log(
			flags.has('--json')
				? JSON.stringify(keys)
				: `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n# keyId: ${keys.keyId}`,
		);
	}
}

main().catch(() => {
	console.error('Command failed. Check input files and configuration.');
	process.exitCode = 1;
});
