# Happy Pet Harbor

Pre-launch pet supplies website for RaeHouser Trading LLC.

- Contact: houserchiu@gmail.com
- Initial category: pet leashes
- Planned expansion: pet hair removal supplies and other pet accessories
- Hosting: Cloudflare Workers Static Assets, worker `happy-pet-harbor`
- Live URL: https://raehouser.com
- Alternate URL: https://www.raehouser.com
- Workers URL: https://happy-pet-harbor.8jtsnkvbf9515.workers.dev
- Custom domains configured: raehouser.com and www.raehouser.com
- Cloudflare zone and certificates active; HTTPS verified on both custom domains. HTTP automatically redirects to HTTPS.

## Local preview

From this folder: `python3 -m http.server 4178 --bind 127.0.0.1 --directory dist`

## Deploy

From this folder: `node ../node_modules/wrangler/bin/wrangler.js deploy --config wrangler.jsonc`

Only `dist/` is published; no secrets are needed for the current static website.

## Remaining launch information

Online payments are NOT connected. Before enabling sales, obtain actual product specifications and images, price and currency, stock/dispatch date, shipping destinations/costs, return/refund terms, and a merchant-owned payment provider account or hosted payment link. A mailto enquiry is not an order. Use provider-hosted checkout; never collect payment card data in email or a static form. Update the homepage, store information and privacy notice together when checkout is enabled.

Domain registration remains with Wyoming Registered Agent Services / DomainRegistry.com. On 2026-09-23, nameservers were changed to `addyson.ns.cloudflare.com` and `sri.ns.cloudflare.com`. Cloudflare zone `f0019c899470f16279f74c39fbeb49e6` is active. Both apex and www custom domains are attached to this Worker. Public DNS checks confirmed the original MX, SPF, DKIM, DMARC, and psrp CNAME records remain in place. The original records are backed up in `ops/raehouser-dns-before-cloudflare.zone`.

HTTPS verified on 2026-09-23: Cloudflare lists all managed certificates as Active, Chrome reports a secure connection, and both custom domains return HTTP 200 with certificate verification enabled. Always Use HTTPS is enabled; HTTP requests to both hostnames and the privacy page return 301 redirects to their HTTPS equivalents, followed by HTTP 200. No payment provider is connected.

## Assets

Lifestyle photograph: Real Natures Food / Unsplash
Source: https://unsplash.com/photos/a-dog-sitting-on-a-couch-TnEytxj87dc/
License: https://unsplash.com/license
The lifestyle photo does not represent a specific product for sale.

Fonts: DM Sans and Manrope, downloaded from Google Fonts and served locally.

## Rope leash product — 2026-09-25

Product preview: `/products/padded-rope-leash/`. User-supplied blue, pink and green product photos are served unchanged as JPG files (replacing the earlier screenshots). Supplier reference: https://detail.1688.com/offer/864785270212.html (page could not be accessed; specifications unverified). Copy describes only visible design. No material, length, strength, reflective performance, price or inventory claims. Price, fulfillment terms and checkout remain pending user input. Color gallery uses native radio inputs and CSS, without scripts.

2026-09-25 update: User confirmed $5.00 USD, 1.5 m length, 1.0 cm width, free shipping and dispatch from Addison, Illinois, USA. Public copy uses city/state only. Delivery destinations, inventory, timing, returns and payment provider remain unconfirmed; checkout stays closed. These details supersede the earlier pending price and size notes.

Product videos: `dist/assets/videos/leash-colors.mp4` (12 s landscape) and `leash-portrait.mp4` (9 s portrait), composed from the user-provided JPG photos with gentle motion and fades. Silent H.264 MP4, native player controls, no autoplay; explicitly labeled photo-based rather than live product demonstrations.

2026-09-26: Removed pre-launch messaging across public pages at user request. Website presents the current collection and email purchase enquiries. Checkout remains unconnected; no inventory or delivery guarantees were added.

2026-10-08: User approved the proposed policies. Added terms/user agreement, shipping, payment/billing, returns/refunds, and support pages; refreshed privacy. Processing 1–3 business days; contiguous-US transit 3–7 business days; AK/HI and special addresses require pre-purchase confirmation. Returns requested within 30 calendar days of receipt; unused/unwashed with original packaging for change-of-mind; buyer pays change-of-mind return postage, seller covers defective/damaged/wrong items; approved refunds initiated in 3–5 business days after return inspection (or approval if no return required), bank posting time varies. All pages identify Happy Pet Harbor and RaeHouser Trading LLC. Payment link remains unconnected.

## Customer accounts and carts

Worker entry: `src/worker.mjs`; schema: `schema.sql`; dedicated D1 database `happy-pet-harbor-shop`. Public browsing and color selection remain static. Same-origin POST forms handle registration/login, server-backed account cart, address save/delete, password change and logout. Passwords use native scrypt (N=32768, r=8, p=3), random salt; sessions use random tokens stored as hashes, 14-day Secure/HttpOnly/SameSite cookies. Auth/action throttling and origin checks protect mutations. Prices are server-controlled ($5 USD). Payments and paid orders remain unconnected. No email verification/reset provider exists; UI states this explicitly.

Apply schema with `node ../node_modules/wrangler/bin/wrangler.js d1 execute happy-pet-harbor-shop --remote --file=schema.sql`. Never log credentials, session tokens, addresses or password hashes.

Validation: 24 functional checks passed locally and against https://raehouser.com, including anonymous add-to-login continuation, two-account isolation, cart persistence after a new login, address save/delete, bad credentials, invalid SKU/quantity, cross-origin rejection and password-change session revocation. Browser confirmed pink selection redirects to login with pending color retained. Production QA accounts were deleted after testing.
