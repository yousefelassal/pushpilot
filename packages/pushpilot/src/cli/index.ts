#!/usr/bin/env node
/**
 * The `pushpilot` command line.
 *
 * ```sh
 * npx pushpilot keygen [--json]
 * npx pushpilot doctor [--env-file <path>] [--url <handler-url>] [--json]
 * ```
 *
 * `keygen` prints a new VAPID key pair as `VAPID_PUBLIC_KEY` and
 * `VAPID_PRIVATE_KEY` lines, or JSON with `--json`. Store the private key as
 * a secret.
 *
 * `doctor` checks `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, and
 * `VAPID_SUBJECT` from the environment (or `--env-file`, where the
 * environment wins). With `--url` it also POSTs `{"action":"config"}` to your
 * handler and verifies the key, JSON response, and `no-store` caching. It
 * exits 0 when every check passes, 1 when one fails, and 2 for bad arguments.
 */
import { readFile } from 'node:fs/promises';
import {
	encodeBase64,
	keyId,
	normalizeKey,
	prepareKeys,
} from '../shared/keys.js';
import { isObject } from '../shared/wire.js';
import type {
	DoctorCheck,
	DoctorEnv,
	Flags,
	GeneratedKeys,
} from './types/doctor.js';

declare const __PUSHPILOT_VERSION__: string;

/** Package version, injected by tsdown from package.json at build time. */
const VERSION = __PUSHPILOT_VERSION__;
const USAGE =
	'pushpilot keygen [--json]\npushpilot doctor [--env-file <path>] [--url <handler-url>] [--json]';
const MAX_PROBE_BYTES = 16384;
const PROBE_TIMEOUT_MS = 10_000;
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '[::1]'];

/** Generates an extractable P-256 pair and returns it in browser-push encoding. */
async function generateVapidKeys(): Promise<GeneratedKeys> {
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

/** Reads assignment syntax as data; shell expansion and command substitution are never evaluated. */
function parseEnvFile(text: string): Record<string, string> {
	const result: Record<string, string> = {};
	for (const line of text.split(/\r?\n/)) {
		const match =
			/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
		if (!match?.[1] || match[2] === undefined) continue;

		const value = match[2];
		const quoted =
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"));
		result[match[1]] = quoted
			? value.slice(1, -1)
			: value.replace(/\s+#.*$/, '');
	}
	return result;
}

async function loadEnv(flags: Flags): Promise<DoctorEnv> {
	const file = flags.get('--env-file');
	const defaults =
		typeof file === 'string' ? parseEnvFile(await readFile(file, 'utf8')) : {};
	return {
		...defaults,
		...Object.fromEntries(
			Object.entries(process.env).filter((entry) => entry[1] !== undefined),
		),
	};
}

async function checkPublicKey(
	env: DoctorEnv,
): Promise<{ check: DoctorCheck; publicKey?: string; fingerprint?: string }> {
	try {
		const publicKey = normalizeKey(env.VAPID_PUBLIC_KEY, 65, 'public key');
		return {
			publicKey,
			fingerprint: await keyId(publicKey),
			check: {
				name: 'public-key',
				ok: true,
				message: 'Public key has valid encoding and length.',
			},
		};
	} catch {
		return {
			check: {
				name: 'public-key',
				ok: false,
				message: 'Set VAPID_PUBLIC_KEY from pushpilot keygen.',
			},
		};
	}
}

function checkPrivateKey(env: DoctorEnv): DoctorCheck {
	try {
		normalizeKey(env.VAPID_PRIVATE_KEY, 32, 'private key');
		return {
			name: 'private-key',
			ok: true,
			message: 'Private key has valid encoding and length.',
		};
	} catch {
		return {
			name: 'private-key',
			ok: false,
			message: 'Set VAPID_PRIVATE_KEY from pushpilot keygen.',
		};
	}
}

async function checkVapid(env: DoctorEnv): Promise<DoctorCheck> {
	try {
		await prepareKeys({
			publicKey: env.VAPID_PUBLIC_KEY,
			privateKey: env.VAPID_PRIVATE_KEY,
			subject: env.VAPID_SUBJECT,
		});
		return {
			name: 'vapid',
			ok: true,
			message: 'Subject and key pair verified.',
		};
	} catch {
		return {
			name: 'vapid',
			ok: false,
			message:
				'Use a valid mailto or HTTPS subject and matching keys. Run pushpilot keygen for a new pair.',
		};
	}
}

/** Allows HTTPS, or plain HTTP only for loopback, and refuses credentials and fragments. */
function parseProbeUrl(value: string): URL {
	const url = new URL(value);
	const secure =
		url.protocol === 'https:' ||
		(url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname));
	if (!secure || url.username || url.password || url.hash) throw new Error();
	return url;
}

/** Reads at most 16 KiB so a misbehaving URL cannot exhaust memory. */
async function readLimitedBody(response: Response): Promise<Uint8Array> {
	let size = 0;
	const parts: Uint8Array[] = [];
	const reader = response.body?.getReader();
	try {
		if (reader)
			for (;;) {
				const next = await reader.read();
				if (next.done) break;
				size += next.value.length;
				if (size > MAX_PROBE_BYTES) throw new Error();
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
	return bytes;
}

async function checkHandler(
	probe: string,
	publicKey: string | undefined,
	fingerprint: string | undefined,
): Promise<DoctorCheck> {
	try {
		const response = await fetch(parseProbeUrl(probe), {
			method: 'POST',
			redirect: 'manual',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ action: 'config' }),
			signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
		});
		const body: unknown = JSON.parse(
			new TextDecoder().decode(await readLimitedBody(response)),
		);
		if (
			response.status !== 200 ||
			!response.headers.get('content-type')?.includes('application/json') ||
			!response.headers.get('cache-control')?.includes('no-store') ||
			!isObject(body) ||
			body.publicKey !== publicKey ||
			body.keyId !== fingerprint
		)
			throw new Error();
		return {
			name: 'handler',
			ok: true,
			message: 'Handler configuration matches and is not cached.',
		};
	} catch {
		return {
			name: 'handler',
			ok: false,
			message:
				'Check the handler URL, keys, JSON response, and no-store header.',
		};
	}
}

function printReport(
	flags: Flags,
	checks: DoctorCheck[],
	fingerprint: string | null,
): void {
	if (flags.has('--json')) {
		const ok = checks.every((check) => check.ok);
		console.log(JSON.stringify({ ok, checks, keyId: fingerprint }));
		return;
	}
	for (const check of checks)
		console.log(`${check.ok ? 'ok' : 'fail'} ${check.name}: ${check.message}`);
	if (fingerprint) console.log(`keyId: ${fingerprint}`);
}

async function runDoctor(flags: Flags): Promise<void> {
	const env = await loadEnv(flags);
	const probe = flags.get('--url');
	const [publicKeyResult, vapidCheck] = await Promise.all([
		checkPublicKey(env),
		checkVapid(env),
	]);
	const checks = [publicKeyResult.check, checkPrivateKey(env), vapidCheck];

	if (typeof probe === 'string')
		checks.push(
			await checkHandler(
				probe,
				publicKeyResult.publicKey,
				publicKeyResult.fingerprint,
			),
		);

	printReport(flags, checks, publicKeyResult.fingerprint ?? null);
	process.exitCode = checks.every((check) => check.ok) ? 0 : 1;
}

async function runKeygen(flags: Flags): Promise<void> {
	const keys = await generateVapidKeys();
	console.log(
		flags.has('--json')
			? JSON.stringify(keys)
			: `VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}\n# keyId: ${keys.keyId}`,
	);
}

/** Returns `null` for any unknown, duplicated, or value-less flag. */
function parseFlags(command: string, args: string[]): Flags | null {
	const flags: Flags = new Map();
	for (let i = 0; i < args.length; i++) {
		const flag = args[i];
		const value = args[i + 1];
		if (flag === '--json' && !flags.has(flag)) {
			flags.set(flag, true);
		} else if (
			command === 'doctor' &&
			(flag === '--env-file' || flag === '--url') &&
			!flags.has(flag) &&
			typeof value === 'string' &&
			value.length > 0 &&
			!value.startsWith('--')
		) {
			flags.set(flag, value);
			i++;
		} else {
			return null;
		}
	}
	return flags;
}

async function main(): Promise<void> {
	const [command, ...args] = process.argv.slice(2);
	if (command === '--version' && !args.length) {
		console.log(VERSION);
		return;
	}
	if (command === '--help' && !args.length) {
		console.log(USAGE);
		return;
	}
	if (command !== 'keygen' && command !== 'doctor') {
		console.error('Use pushpilot --help.');
		process.exitCode = 2;
		return;
	}

	const flags = parseFlags(command, args);
	if (!flags) {
		console.error('Invalid arguments. Use pushpilot --help.');
		process.exitCode = 2;
		return;
	}

	if (command === 'doctor') await runDoctor(flags);
	else await runKeygen(flags);
}

main().catch(() => {
	console.error('Command failed. Check input files and configuration.');
	process.exitCode = 1;
});
