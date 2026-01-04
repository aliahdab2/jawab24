import { NextRequest, NextResponse } from 'next/server';

export function middleware(request: NextRequest) {
    const { pathname, search } = request.nextUrl;

    // Redirect /en/auth/callback and /ar/auth/callback to /auth/callback
    // This ensures OAuth works with a single redirect URI in Facebook
    if (pathname === '/en/auth/callback' || pathname === '/ar/auth/callback') {
        const url = request.nextUrl.clone();
        url.pathname = '/auth/callback';
        // Preserve the OAuth code and state parameters
        url.search = search;
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/en/auth/callback',
        '/ar/auth/callback',
    ],
};
