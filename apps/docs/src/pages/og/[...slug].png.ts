import { mkdir, writeFile } from 'node:fs/promises';
import type { GetStaticPaths, APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { documentationCard, type DocumentationCard } from '../../lib/og';
import { renderDocumentationCard } from '../../lib/og-render';

export const prerender = true;

export const getStaticPaths = (async () => {
	const cards = (await getCollection('docs')).flatMap((entry) => {
		const card = documentationCard(entry, import.meta.env.BASE_URL);
		return card ? [card] : [];
	});
	await mkdir('.astro', { recursive: true });
	await writeFile('.astro/og-cards.json', JSON.stringify(cards));
	return cards.map((card) => ({
		params: { slug: card.imageSlug },
		props: { card },
	}));
}) satisfies GetStaticPaths;

export const GET: APIRoute<{ card: DocumentationCard }> = async ({ props }) =>
	new Response(await renderDocumentationCard(props.card), {
		headers: { 'Content-Type': 'image/png' },
	});
