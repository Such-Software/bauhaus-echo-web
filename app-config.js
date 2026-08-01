// Public web-app config. NO SECRETS — only public values Operations populates at
// deploy time once the OIDC client + shop tenant exist. All null/false here → the
// checkout flow is INERT (fail-closed): the "Get the Full Game" CTA falls through
// to the store links, premium stays false, guest-first play is untouched.
//
// Operations replaces this file (or the values) at deploy; the client never holds
// a secret — per-user premium is resolved via the user's own OIDC session.
window.SUCH_APP_CONFIG = {
  oidcIssuer: null,        // e.g. https://id.such.software  (SUCH_APP_OIDC_ISSUER)
  oidcClientId: null,      // PUBLIC native/SPA client id    (SUCH_APP_OIDC_CLIENT_ID)
  ledgerBase: null,        // e.g. https://entitlements.such.software (such-entitlement-ledger)
  checkoutUrl: null,       // bauhaus-scoped shop entry, e.g. https://shop.bauhausecho.com/...
  checkoutEnabled: false,  // master flag — CLOSED until the tenant is provisioned + activated
};
