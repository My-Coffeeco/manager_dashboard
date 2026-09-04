# My Coffee Co. dashboard previews

This directory is intentionally isolated from the existing middleware. It provides a private manager UI and the source for an editor-only Shopify customer-dashboard design preview.

## Safety boundary

- `DATA_MODE=preview` is mandatory; attaching a recognised production integration secret makes startup fail.
- No Shopify, Shiprocket, WhatsApp, Klaviyo, Rista or analytics API call exists in this runtime.
- The only credentials are a single preview-reviewer username/password configured in Render. There is no public signup.
- Landing-page records and audit entries use temporary SQLite storage. Render free-service redeploys may reset them.
- Six landing pages begin as `draft`; their production status is deliberately not claimed.
- The customer preview uses explicitly labelled sample identity data and empty orders/wishlist/subscription states. Profile Save works in browser memory only and resets on refresh; no customer changes are sent anywhere. Tracking, addresses, loyalty and notifications remain disconnected.

## Render preview service

Repository: `Mycoffeeco/mycoffeeco-dashboard-preview` (private). This is a separate preview repository; the original middleware repository is unchanged.

Root directory: leave blank (repository root).

Build: `npm ci && npm test`  
Start: `npm start`  
Health: `/healthz`

Required preview-only variables:

- `NODE_VERSION=24`
- `DATA_MODE=preview`
- `PUBLIC_ORIGIN=https://<exact-preview-host>`
- `PREVIEW_ADMIN_USER=preview-manager`
- `PREVIEW_ADMIN_PASSWORD=<at-least-16-characters>`

Do not attach production environment groups or secrets.

The main branch of this separate repository is a preview branch, not the original production branch. Keep automatic deploys scoped to this preview service only.

Manager URL: `/manager`; customer design URL: `/customer`. Both require reviewer authentication. This access gate is not a replacement customer login. Customer authentication remains a Shopify-only integration to activate after approval.

The Raleway font is licensed under the SIL Open Font License; see `OFL-Raleway.txt`. The logo is the official asset supplied by the existing public My Coffee Co. storefront.

The customer layout uses brand blue `#0A06FF`, brand yellow `#F6A90A` and white. Styles and scripts are isolated from the manager dashboard. `npm run build:customer` packages the same source into the gated Liquid template. Store header links open the existing store in a new tab; preview search/cart controls do not read or mutate Shopify data. Change Password explains the Shopify-owned account security boundary; Logout ends the reviewer session only after confirmation.

## Shopify design preview

Upload `index.mcc-customer-preview.liquid` only to a new **unpublished** theme as `templates/index.mcc-customer-preview.liquid`. The file emits the dashboard only when Shopify supplies `request.design_mode`; an ordinary visitor gets only a noindex “Not available” page. Keep the theme unpublished. Production theme `147584581741` is out of scope.

## Production approval gate

Approval is not an instruction to reuse this temporary store. Production requires reviewed Shopify admin/customer OAuth, persistent storage, named staff accounts with roles, durable audit retention, Shiprocket, WhatsApp consent records and verified Shopify analytics attribution.
