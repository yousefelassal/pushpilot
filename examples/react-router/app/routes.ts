import { index, route, type RouteConfig } from '@react-router/dev/routes';

export default [
	index('routes/home.tsx'),
	route('api/push', 'routes/api.push.ts'),
	route('api/notify', 'routes/api.notify.ts'),
] satisfies RouteConfig;
