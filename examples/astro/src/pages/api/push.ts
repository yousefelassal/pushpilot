import type { APIRoute } from 'astro';
import { demo } from '../../demo';
export const POST: APIRoute = ({ request }) => demo.handler(request);
