/*
 * Fail-closed web-app → checkout wiring for Bauhaus Echo.
 *
 * Flow (only when window.SUCH_APP_CONFIG is fully populated + checkoutEnabled):
 *   CTA "Get the Full Game" → neutral OIDC login (Authorization Code + S256 PKCE,
 *   PUBLIC client, no secret) → hand off to the bauhaus-scoped Medusa storefront →
 *   Stripe / approved-crypto checkout → shop webhook → the entitlement ledger grants
 *   neutral `premium` → this script polls the ledger's per-user /me/entitlements with
 *   the user's OWN OIDC token and sets window.SUCH_APP.premium, which WebBillingManager
 *   (GWT) reads to flip the client (kills the AdSense nag, unlocks packs). Crypto is
 *   webhook-driven, so premium also resolves on the next page load / login.
 *
 * Everything is INERT until Operations populates the public config: unconfigured →
 * the CTA falls through to the App Store / Google Play / itch links, premium stays
 * false. No secrets here; the client never holds the ledger's shared read token.
 */
(function () {
  'use strict';

  var CFG = window.SUCH_APP_CONFIG || {};
  var ISSUER = CFG.oidcIssuer || null;
  var CLIENT = CFG.oidcClientId || null;
  var LEDGER = CFG.ledgerBase || null;
  var SHOP_URL = CFG.checkoutUrl || null;
  var ENABLED = CFG.checkoutEnabled === true;
  var REDIRECT = window.location.origin + window.location.pathname;
  var SCOPE = 'openid';

  // configured = every piece needed to run the real flow is present.
  var configured = !!(ENABLED && ISSUER && CLIENT && LEDGER && SHOP_URL);

  // The single source WebBillingManager (GWT) reads. premium left undefined until
  // resolved → GWT reads false (fail-closed).
  window.SUCH_APP = window.SUCH_APP || {};
  window.SUCH_APP.checkoutEnabled = configured;
  window.SUCH_APP.checkoutUrl = SHOP_URL;

  var enc = encodeURIComponent;
  function form(obj) {
    return Object.keys(obj).filter(function (k) { return obj[k] != null; })
      .map(function (k) { return enc(k) + '=' + enc(obj[k]); }).join('&');
  }
  function trimSlash(s) { return String(s).replace(/\/+$/, ''); }

  // base64url of raw bytes
  function b64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function randToken() {
    var a = new Uint8Array(32);
    crypto.getRandomValues(a);
    return b64url(a);
  }
  async function sha256b64url(str) {
    var digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return b64url(new Uint8Array(digest));
  }

  var K_VERIFIER = 'such_pkce_verifier';
  var K_STATE = 'such_oidc_state';
  var K_TOKEN = 'such_access_token';
  var K_PENDING = 'such_pending_checkout';

  // Begin OIDC login (redirects away). Marks the intent to buy so we hand off to
  // the shop after the token round-trip.
  async function startLogin() {
    var verifier = randToken();
    var state = randToken();
    sessionStorage.setItem(K_VERIFIER, verifier);
    sessionStorage.setItem(K_STATE, state);
    sessionStorage.setItem(K_PENDING, '1');
    var challenge = await sha256b64url(verifier);
    var url = trimSlash(ISSUER) + '/authorize?' + form({
      client_id: CLIENT, redirect_uri: REDIRECT, response_type: 'code',
      scope: SCOPE, code_challenge: challenge, code_challenge_method: 'S256', state: state,
    });
    window.location.assign(url);
  }

  // Complete the code→token exchange if we returned from the IdP with ?code.
  async function completeLoginIfCallback() {
    var q = new URLSearchParams(window.location.search);
    var code = q.get('code');
    var state = q.get('state');
    if (!code) return;
    var ok = state && state === sessionStorage.getItem(K_STATE);   // CSRF guard
    var verifier = sessionStorage.getItem(K_VERIFIER);
    // Always scrub code/state from the URL + one-time PKCE material.
    history.replaceState({}, document.title, REDIRECT);
    sessionStorage.removeItem(K_VERIFIER);
    sessionStorage.removeItem(K_STATE);
    if (!ok || !verifier || !configured) return;
    try {
      var res = await fetch(trimSlash(ISSUER) + '/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form({ grant_type: 'authorization_code', code: code, redirect_uri: REDIRECT,
          client_id: CLIENT, code_verifier: verifier }),
      });
      if (res.ok) {
        var tok = await res.json();
        if (tok && tok.access_token) sessionStorage.setItem(K_TOKEN, tok.access_token);
      }
    } catch (e) { /* fail-closed */ }
  }

  // Resolve the neutral premium capability from the user's own OIDC token.
  async function resolvePremium() {
    var token = sessionStorage.getItem(K_TOKEN);
    if (!token || !LEDGER) return;
    try {
      var res = await fetch(trimSlash(LEDGER) + '/me/entitlements', {
        headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' },
      });
      if (res.ok) {
        var data = await res.json();
        window.SUCH_APP.premium = !!(data && data.premium === true);
      }
    } catch (e) { /* fail-closed */ }
  }

  // Called by the CTA. Returns true if it handled the click (login started), false
  // to let the anchor's store links proceed (unconfigured / fail-closed).
  window.SUCH_APP_startCheckout = function () {
    if (!configured) return false;
    startLogin();
    return true;
  };

  // On load: finish any OIDC callback, resolve premium (returning buyers + the
  // post-purchase page reload flip premium before the GWT game boots), then — if we
  // logged in intending to buy and don't already own it — hand off to the shop.
  (async function () {
    await completeLoginIfCallback();
    await resolvePremium();
    if (configured && sessionStorage.getItem(K_PENDING) === '1') {
      sessionStorage.removeItem(K_PENDING);
      if (window.SUCH_APP.premium !== true) window.location.assign(SHOP_URL);
    }
  })();
})();
