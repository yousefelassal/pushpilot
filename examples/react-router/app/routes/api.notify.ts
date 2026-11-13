import type { Route } from './+types/api.notify';
import { notify } from '../push.server';

export const action = ({ request }: Route.ActionArgs) => notify(request);
