import type { APIRoute } from 'astro';
import { pushHandler } from '../../push.server';

export const prerender = false;

export const POST: APIRoute = ({ request }) => pushHandler(request);
