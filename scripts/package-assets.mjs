import { copyFile, chmod } from 'node:fs/promises';
for (const name of ['README.md', 'LICENSE'])
	await copyFile(
		new URL(`../${name}`, import.meta.url),
		new URL(`../packages/pushpilot/${name}`, import.meta.url),
	);
await chmod(
	new URL('../packages/pushpilot/dist/cli/index.js', import.meta.url),
	0o755,
);
