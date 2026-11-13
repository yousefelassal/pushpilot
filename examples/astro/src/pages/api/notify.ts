import type { APIRoute } from 'astro';
import { notify } from '../../push.server';

export const prerender = false;

export const POST: APIRoute = ({ request }) => notify(request);
