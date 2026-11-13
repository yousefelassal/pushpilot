import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { verifyCrypto } from './crypto-check.mjs';
const root = process.env.PUSHPILOT_SMOKE_PACKAGE;
assert(root, 'Set PUSHPILOT_SMOKE_PACKAGE to the installed package directory.');
const { createPush } = await import(
	pathToFileURL(`${root}/dist/server/index.js`).href
);
const { createPushClient } = await import(
	pathToFileURL(`${root}/dist/client/index.js`).href
);
console.log(
	`PASS ${process.versions.bun ? 'bun' : process.versions.deno ? 'deno' : 'node'} ${await verifyCrypto(createPush, createPushClient)}`,
);
