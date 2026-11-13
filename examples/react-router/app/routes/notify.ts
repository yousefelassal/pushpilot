import type { ActionFunctionArgs } from 'react-router';
import { demo } from '../demo';
export const action = ({ request }: ActionFunctionArgs) => demo.notify(request);
