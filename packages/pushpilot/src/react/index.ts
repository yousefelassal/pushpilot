'use client';
import { useEffect, useSyncExternalStore } from 'react';
import type { PushClient, PushState } from '../client/types.js';
export type { PushClient, PushState } from '../client/types.js';

export function usePush(client: PushClient): PushState {
	const state = useSyncExternalStore(
		client.listen,
		client.getSnapshot,
		client.getServerSnapshot,
	);
	useEffect(() => client.start(), [client]);
	return state;
}
