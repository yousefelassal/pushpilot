# Documentation build

Run `pnpm docs:build` from the workspace root. The build checks Astro types,
prerenders a 1200×630 Takumi PNG for each published documentation entry, and verifies
the generated HTML metadata and PNG headers. Draft entries and the 404 page have no
cards. Examples outside the docs collection are not published here.

Set `DOCS_SITE_ORIGIN` to the deployment's HTTP(S) origin, without a trailing slash,
to emit absolute image and canonical URLs. No deployment host is assumed. Without
this variable, image URLs are root-relative and Starlight omits canonical URLs.
Configure the origin for production so social crawlers can resolve images reliably.

The prerendered `/og/…png` files need only static hosting. Takumi and its locally
installed Atkinson Hyperlegible fonts run during the build, with no network font
requests. The font package includes its SIL Open Font License. The renderer and its
verification inventory in `.astro/og-cards.json` are not published.

To verify a deployment under a path prefix, run these commands from `apps/docs`.
The origin below is a test value, not the project's deployment URL.

```sh
DOCS_SITE_ORIGIN=https://docs.example.test pnpm exec astro build --base /manual
DOCS_SITE_ORIGIN=https://docs.example.test DOCS_VERIFY_BASE=/manual node scripts/verify-og.mjs
```
