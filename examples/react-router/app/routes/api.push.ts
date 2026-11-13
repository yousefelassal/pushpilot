import type { Route } from './+types/api.push';
import { pushHandler } from '../push.server';

export const action = ({ request }: Route.ActionArgs) => pushHandler(request);
