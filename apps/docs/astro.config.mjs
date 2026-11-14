import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import { DOCS_DESCRIPTION } from './src/lib/og.ts';

const origin = process.env.DOCS_SITE_ORIGIN;
if (origin) {
	const url = new URL(origin);
	if (!['https:', 'http:'].includes(url.protocol) || url.origin !== origin) {
		throw new Error(
			'DOCS_SITE_ORIGIN must be an HTTP(S) origin without a path or trailing slash.',
		);
	}
}
export default defineConfig({
	site: origin,
	integrations: [
		starlight({
			title: 'pushpilot',
			description: DOCS_DESCRIPTION,
			routeMiddleware: './src/route-middleware.ts',
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					href: 'https://github.com/yousefelassal/pushpilot',
				},
			],
			sidebar: [
				{
					label: 'Getting started',
					items: [
						{ label: 'Introduction', slug: 'getting-started/introduction' },
						{ label: 'Quickstart', slug: 'quickstart' },
					],
				},
				{
					label: 'Concepts',
					items: [
						{
							label: 'Subscriptions and storage',
							slug: 'concepts/subscriptions-and-storage',
						},
						{
							label: 'Sending and pruning',
							slug: 'concepts/sending-and-pruning',
						},
						{ label: 'Key rotation', slug: 'concepts/key-rotation' },
						{ label: 'Service worker', slug: 'concepts/service-worker' },
					],
				},
				{
					label: 'Frameworks',
					items: [
						{ label: 'Next.js', slug: 'frameworks/nextjs' },
						{ label: 'Hono', slug: 'frameworks/hono' },
						{ label: 'React Router', slug: 'frameworks/react-router' },
						{ label: 'Astro', slug: 'frameworks/astro' },
					],
				},
				{
					label: 'Guides',
					items: [
						{ label: 'Store subscriptions', slug: 'guides/storage' },
						{
							label: 'Build the service worker',
							slug: 'guides/service-worker-setup',
						},
						{ label: 'Authentication and secrecy', slug: 'guides/security' },
						{
							label: 'Queue sends and diagnose failures',
							slug: 'guides/operations',
						},
						{ label: 'Runtime and browser support', slug: 'guides/platforms' },
						{ label: 'Release verification', slug: 'guides/release-checks' },
					],
				},
				{
					label: 'Reference',
					items: [
						{ label: 'Server and HTTP', slug: 'reference/server' },
						{ label: 'Browser client', slug: 'reference/client' },
						{ label: 'React hook', slug: 'reference/react' },
						{ label: 'Service worker and CLI', slug: 'reference/worker-cli' },
					],
				},
			],
		}),
	],
});
