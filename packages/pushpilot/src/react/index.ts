'use client';
import { useEffect, useSyncExternalStore } from 'react';
import type { PushClient, PushState } from '../client/types/index.js';

export type { PushClient, PushState } from '../client/types/index.js';

/**
 * React hook that binds a {@link PushClient} to a component. It subscribes to
 * state changes, renders `{ status: 'unknown' }` on the server, and calls
 * `client.start()` on mount and releases it on unmount.
 *
 * Create the client once, outside the component, so every consumer shares it.
 *
 * @param client A client from `createPushClient`.
 * @returns The current {@link PushState}.
 *
 * @example
 * ```tsx
 * 'use client';
 * import { createPushClient } from 'pushpilot/client';
 * import { usePush } from 'pushpilot/react';
 *
 * const client = createPushClient();
 *
 * export function PushToggle() {
 *   const state = usePush(client);
 *   if (state.status === 'subscribed')
 *     return <button onClick={() => client.disable()}>Turn off</button>;
 *   return <button onClick={() => client.enable()}>Turn on</button>;
 * }
 * ```
 */
export function usePush(client: PushClient): PushState {
	const state = useSyncExternalStore(
		client.listen,
		client.getSnapshot,
		client.getServerSnapshot,
	);
	useEffect(() => client.start(), [client]);
	return state;
}
