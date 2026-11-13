import { index, route, type RouteConfig } from '@react-router/dev/routes';
export default [
	index('routes/home.tsx'),
	route('api/push', 'routes/push.ts'),
	route('api/notify', 'routes/notify.ts'),
] satisfies RouteConfig;
