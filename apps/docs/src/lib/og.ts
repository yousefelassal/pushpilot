import type { CollectionEntry } from 'astro:content';

export const OG_DIMENSIONS = { width: 1200, height: 630 };
export const DOCS_DESCRIPTION =
	'Web Push for applications that own their infrastructure.';

/** Public documentation content and its matching static page and image paths. */
export interface DocumentationCard {
	title: string;
	description: string;
	pagePath: string;
	imagePath: string;
	imageSlug: string;
}

/** Mirrors Starlight's production draft exclusion and root index normalization. */
export function documentationCard(
	entry: Pick<CollectionEntry<'docs'>, 'id' | 'data'>,
	base: string,
): DocumentationCard | undefined {
	if (entry.data.draft || entry.id === '404') return;
	const slug = entry.id === 'index' ? '' : entry.id;
	const prefix = `${base.replace(/\/$/, '')}/`;
	return {
		title: entry.data.title,
		description: entry.data.description || DOCS_DESCRIPTION,
		pagePath: `${prefix}${slug ? `${slug}/` : ''}`,
		imagePath: `${prefix}og/${slug || 'index'}.png`,
		imageSlug: slug || 'index',
	};
}

/** Uses a configured origin without inferring a deployment host from build requests. */
export function imageUrl(
	card: DocumentationCard,
	site: URL | undefined,
): string {
	return site ? new URL(card.imagePath, site).href : card.imagePath;
}
