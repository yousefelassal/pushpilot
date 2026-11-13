import { defineConfig } from 'tsdown';
import pkg from './package.json' with { type: 'json' };

export default defineConfig(
	['server', 'client', 'react', 'sw', 'cli'].map((entry) => ({
		entry: [`src/${entry}/index.ts`],
		outDir: `dist/${entry}`,
		platform: 'neutral',
		target: 'es2022',
		format: 'esm',
		dts: true,
		clean: true,
		sourcemap: true,
		external: ['react', /^node:/],
		define: { __PUSHPILOT_VERSION__: JSON.stringify(pkg.version) },
		...(entry === 'react' ? { banner: '"use client";' } : {}),
	})),
);
