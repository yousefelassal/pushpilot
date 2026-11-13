import { NextResponse, type NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
	const response = NextResponse.next();

	if (!request.cookies.has('demo_user'))
		response.cookies.set('demo_user', crypto.randomUUID(), {
			httpOnly: true,
			sameSite: 'lax',
			path: '/',
		});

	return response;
}

export const config = { matcher: '/' };
