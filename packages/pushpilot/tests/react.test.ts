import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import { usePush } from '../src/react/index.js';
import { createPushClient } from '../src/client/index.js';

it('renders the server snapshot without starting or reading window', () => {
	const client = createPushClient();
	const start = vi.spyOn(client, 'start');
	function Toggle() {
		return createElement('span', null, usePush(client).status);
	}
	expect(renderToString(createElement(Toggle))).toBe('<span>unknown</span>');
	expect(start).not.toHaveBeenCalled();
});
