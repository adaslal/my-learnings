---
title: Spotify Player (User OAuth + Spotify Connect)
---

# Salesforce → Spotify Player (User OAuth + Spotify Connect Playback)

Extends the [Client Credentials Spotify integration](./spotify.md) — public data only — to a **full user-context integration**: a Spotify-style home screen LWC that searches tracks, browses the logged-in user's own playlists and recently played, and controls playback on their phone/desktop via **Spotify Connect**.

This is the first Salesforce project using **per-user OAuth via External Credentials** rather than machine-to-machine Client Credentials. Most of the value here is in the gotchas — real ones hit while building against a live Spotify account, not theoretical.

---

## Architecture

```
spotifyHome (LWC, dark themed, sp- prefix)
   │  imperative Apex
   ▼
SpotifyPlayerService (Apex)
   │  callout:Spotify_User   (token injected automatically — Apex never sees it)
   ▼
Named Credential "Spotify_User"  →  External Credential "Spotify_User_Auth"
   →  External Auth Identity Provider "Spotify"  (OAuth 2.0, Authorization Code / Browser Flow)
   ▼
Spotify Web API   /me/playlists   /search   /me/player/*
```

Key design choice: **playback is Spotify Connect remote control, not in-browser audio.** Salesforce never streams audio — it tells Spotify "play track X on device Y," and the user's phone/desktop/web player (a running Spotify *client*) is the actual speaker. This is architecturally identical to how Alexa or a smart TV plays Spotify — nobody streams audio through the control-plane device itself.

---

## OAuth client authentication: more than one way to prove who you are

While building this, a natural question came up: `SpotifyAuthService` (the Client Credentials class) sends `client_id`/`client_secret` as an HTTP Basic header — why not just POST them in the body?

Both are valid per RFC 6749, and Spotify accepts either:

| Method | How | Notes |
|---|---|---|
| `client_secret_basic` | `Authorization: Basic base64(id:secret)` header | Spec default/recommended; what `SpotifyAuthService` uses |
| `client_secret_post` | `client_id=...&client_secret=...` in POST body | Also valid; slightly more exposure to logging middleware |
| `private_key_jwt` | Client signs a JWT with a private key instead of sending a secret | Used by Salesforce's own JWT Bearer flow |
| mTLS | Client presents a TLS certificate | Higher-trust B2B integrations |
| PKCE | No client secret at all — for public clients that can't keep one | Required for mobile apps (relevant for future Play Store apps) |

**Base64 is encoding, not encryption** — trivially reversible. The only real protection in either Basic or body-post is TLS. Salesforce's External Auth Identity Provider surfaces this exact choice as the **"Pass client credentials in request body"** checkbox — leave it **unchecked** for Spotify (Basic header).

---

## Setup: the parts that didn't match the docs

### Newer orgs use External Auth Identity Provider, not classic Auth Provider

The textbook Salesforce recipe for third-party OAuth is: **Auth Provider → External Credential → Named Credential**. This org instead exposed a newer, separate feature:

**Setup → Named Credentials → External Auth Identity Providers tab** (a third tab alongside Named Credentials and External Credentials).

This replaces the Auth Provider for OAuth 2.0 Authorization Code (Browser Flow) external credentials, and **generates its own callback URL** — different from the classic `/services/authcallback/<name>` URL. Register *that* callback URL in the Spotify app's Redirect URI settings, not the legacy one.

Fields that matter:
- Authentication Protocol: OAuth 2.0
- Authentication Flow Type: Authorization Code (Browser Flow)
- Pass client credentials in request body: **unchecked**
- Authorize/Token/User Info endpoint URLs: `accounts.spotify.com/authorize`, `accounts.spotify.com/api/token`, `api.spotify.com/v1/me`
- Scopes: `user-read-private user-read-email user-read-playback-state user-modify-playback-state user-read-recently-played playlist-read-private playlist-read-collaborative`

On the External Credential, the **Identity Provider field is a dropdown, not a URL field** — select the provider record; never paste a callback URL into Salesforce anywhere.

### Per User Principal has no Authenticate button in Setup

Named Principals (shared org-wide login) show an **Authenticate** action in Setup. **Per User Principals do not** — each user authenticates their *own* account from **personal settings**, not Setup:

Avatar → Settings → **External Credentials** (in the left nav under My Personal Information) → find the credential → Authenticate.

Two traps:
1. There's a *legacy* page called **"Authentication Settings for External Systems"** one item above it in the nav — it's for old-style named credentials and will always show "No records to display" for this setup. The real page is **External Credentials**.
2. The Authenticate action won't even appear until the user's permission set grants **External Credential Principal Access** for that specific principal, plus **Read** on the `UserExternalCredential` object (a separate object-permission grant, easy to miss).

---

## Apex: SpotifyPlayerService

Core shape (trimmed for brevity — full class lives in the `Spotify_ClientCredentials_Project` SFDX project):

```apex
public with sharing class SpotifyPlayerService {
    private static final String BASE = 'callout:Spotify_User/v1';

    @AuraEnabled
    public static HomeData getHome() {
        HomeData home = new HomeData();
        Map<String, Object> me = getJson('/me');
        home.displayName = (String) me.get('display_name');
        home.playlists = parsePlaylists(...);      // GET /me/playlists?limit=12
        home.recentTracks = parseRecentTracks(...); // GET /me/player/recently-played?limit=20
        return home;
    }

    @AuraEnabled
    public static List<TrackItem> searchTracks(String query) {
        if (String.isBlank(query)) return new List<TrackItem>();
        // NOTE: Spotify's /search caps limit at 10 — see gotcha below
        Map<String, Object> body = getJson('/search?type=track&limit=10&q=' + EncodingUtil.urlEncode(query, 'UTF-8'));
        ...
    }

    @AuraEnabled public static List<DeviceItem> getDevices() { ... }        // GET /me/player/devices
    @AuraEnabled public static NowPlaying getNowPlaying() { ... }            // GET /me/player/currently-playing
    @AuraEnabled public static void playTrack(String trackUri, String deviceId) { ... }   // PUT /me/player/play {uris:[...]}
    @AuraEnabled public static void playContext(String contextUri, String deviceId) { ... } // PUT /me/player/play {context_uri:...}
    @AuraEnabled public static void pausePlayback() { ... }   // PUT /me/player/pause
    @AuraEnabled public static void resumePlayback() { ... }  // PUT /me/player/play, no body — resumes, doesn't restart
    @AuraEnabled public static void skipNext() { ... }        // POST /me/player/next
}
```

### Error contract: Apex → LWC via message prefixes

Rather than raw Spotify error bodies, Apex maps HTTP status codes to prefixed messages the LWC switches UI state on:

```apex
private static AuraHandledException friendlyError(HttpResponse res) {
    Integer code = res.getStatusCode();
    String msg;
    if (code == 401 || code == 403) {
        msg = 'NOT_CONNECTED: Your Spotify account is not linked yet...';
    } else if (code == 404) {
        msg = 'NO_DEVICE: No active Spotify device found. Open Spotify on your ' +
              'phone or desktop, play/pause once, then try again.';
    } else if (code == 429) {
        msg = 'RATE_LIMIT: Spotify rate limit hit. Wait a moment and retry.';
    } else {
        msg = 'SPOTIFY_ERROR [' + code + ']: ' + res.getBody();
    }
    AuraHandledException e = new AuraHandledException(msg);
    e.setMessage(msg);
    return e;
}
```

LWC side just checks the prefix:

```javascript
_handleError(err) {
    const raw = (err?.body?.message) || err.message || 'Unknown error';
    if (raw.startsWith('NOT_CONNECTED')) {
        this.notConnected = true;       // show "Connect your Spotify account" card
    } else if (raw.startsWith('NO_DEVICE')) {
        this.errorMessage = 'No active Spotify device. Open Spotify on your phone...';
    } else {
        this.errorMessage = raw.replace(/^[A-Z_]+:\s*/, '');
    }
}
```

A cheap, reusable pattern for any Apex↔LWC integration where the UI needs to branch on *why* a call failed, not just *that* it failed.

---

## Bugs hit, and what they taught

### 1. `limit` is a reserved word in Apex

The original Client Credentials `SpotifyService.search(String query, Integer limit)` had **never actually compiled** — `limit` collides with the SOQL `LIMIT` keyword. Ten separate compile errors surfaced only when deploying this whole project together. Renamed the parameter to `maxResults`.

**Lesson:** code that's never been deployed is unverified, no matter how complete it looks. Never use `limit`, `group`, `order`, or other SOQL keywords as Apex identifiers.

### 2. Spotify's `/search` endpoint caps `limit` at 10 — not 50

Typing a search query returned `SPOTIFY_ERROR [400]: {"error": {"status": 400, "message": "Invalid limit"}}`. Checked Spotify's own docs rather than guessing: **`/v1/search`'s `limit` parameter is range 0–10, default 5** — unlike `/me/playlists` or `/me/player/recently-played`, which allow up to 50.

**Lesson:** don't assume one endpoint's limits apply org-wide across the same API. `/search` is deliberately narrow ("find the one thing"), not a bulk-browse endpoint.

### 3. A template handler with no matching JS method fails silently

The header's refresh button was wired to `onclick={handleRefresh}` in the `.html`, but `handleRefresh()` was never actually written in the `.js`. LWC doesn't error loudly on this — the click just does nothing, and stale error state never clears.

**Lesson:** after writing a template, grep every `onclick={...}`/`oninput={...}` handler name against the JS file and confirm each one exists as a method. Cheap check, easy to skip, easy to miss visually.

### 4. Spotify Connect only recognizes *active* devices, not idle-but-available ones

Initial device logic only looked for `is_active: true` in `/me/player/devices`. If Spotify was open on desktop but paused (not "active"), the app reported "No active device" even though a play command *would* have woken it. Fixed by falling back to any *available* device (`devices[0]`) when none is marked active — playing to that device's ID transfers/wakes it.

**Lesson:** "active" and "available" are different states in Spotify's device model; a remote-control integration should target whichever exists, since a play command can promote an idle device to active.

### 5. Spotify's playback API has no "unpause" endpoint

Pause is `PUT /me/player/pause`. Resume is **`PUT /me/player/play` with no body** — the same endpoint used to start a new track, just without a `uris`/`context_uri` payload, which tells Spotify to continue where it left off. There's no separate resume/unpause endpoint.

Implemented as a single toggle button (not separate Pause/Play buttons) driven by `nowPlaying.isPlaying`, with an optimistic local flip on click so the icon changes instantly instead of waiting for the next poll:

```javascript
async handleToggle() {
    const wasPlaying = this.nowPlaying?.isPlaying;
    if (this.nowPlaying) {
        this.nowPlaying = { ...this.nowPlaying, isPlaying: !wasPlaying }; // optimistic
    }
    await this._play(() => (wasPlaying ? pausePlayback() : resumePlayback()));
}
```

### 6. Spotify has no push API for playback state — poll + interpolate locally

There's no webhook/event stream for "track changed" or "progress updated." The now-playing bar polls `getNowPlaying()` every 5 seconds and **advances the progress bar locally every 1 second** in between, so the UI feels live without hammering the API:

```javascript
connectedCallback() {
    this._pollTimer = setInterval(() => this._pollNowPlaying(), 5000);
    this._tickTimer = setInterval(() => this._tickProgress(), 1000);
}

_tickProgress() {
    if (this.nowPlaying?.isPlaying) {
        this.nowPlaying = {
            ...this.nowPlaying,
            progressMs: Math.min(this.nowPlaying.progressMs + 1000, this.nowPlaying.durationMs)
        };
    }
}
```

**Lesson:** poll + local interpolation is the standard workaround for any "live" UI over a pull-only API — not Spotify-specific.

### 7. UX: a persistent player belongs above the fold

First cut placed the now-playing bar at the bottom of the component, meaning any nontrivial page required scrolling to see or control playback — the opposite of how every real music app places its transport controls. Moved it into a strip directly under the header (art, track name, artist, Pause/Next, live progress bar), visible immediately, collapsing entirely when nothing is playing.

**Lesson:** persistent status/controls should never depend on scroll position; this is a basic but easy-to-miss layout mistake when building bottom-up from a wireframe instead of thinking about where a user's eyes land first.

---

## Tested and ruled out: Web Playback SDK (audio inside the browser tab)

The remaining gap after all of the above: audio comes out of a phone/desktop, never the Salesforce tab itself. Spotify's **Web Playback SDK** can register a browser tab as a real playback device. This was spiked end-to-end and has a **conclusive negative result** — worth documenting precisely so it's never re-attempted without new evidence.

### What the SDK actually needs (read from its own source, not assumed)

Contrary to the initial assumption that the SDK opens its own websocket connections, its actual mechanism is: load a small bootstrap script that defines `window.Spotify.Player`, then on construction it creates a **hidden `<iframe>`** pointing to `https://sdk.scdn.co/embedded/index.html` and talks to it via `postMessage`. All of Spotify's real network traffic happens inside that iframe, under Spotify's own CSP — not the host page's.

That reframes the requirements:
1. **Loading the bootstrap script** — Salesforce CSP Trusted Sites can never allowlist `script-src` for remote JS in any LWC (verified — no admin setting overrides this). The supported pattern instead: download the SDK file once and deploy it as a **Static Resource**, loaded via `lightning/platformResourceLoader`'s `loadScript`. This part works cleanly and is a standard, fully-supported pattern.
2. **The hidden iframe** — needs a CSP Trusted URL allowing `frame-src` for `sdk.scdn.co`. This directive *is* supported by Salesforce Trusted URLs (Setup → Security → Trusted URLs), and setting it up was straightforward.
3. **`getOAuthToken` needs a raw bearer token** in browser JS — the Named Credential/External Credential setup used throughout this page deliberately never exposes a token to Apex or JS; the platform injects it invisibly at callout time. For a throwaway spike, a manually-obtained token (Spotify's Authorization Code flow, exchanged locally via `curl` so the client secret never left the developer's machine) stood in for what a full build would need — a **second, parallel OAuth flow** in Apex, since production use can't rely on manual token grabs.

### The actual blocker: Permissions Policy, not CSP or Locker

With the static resource loaded, the CSP Trusted URL in place, and a valid throwaway token wired into `getOAuthToken`, the SDK's `Player` construction still failed. Browser DevTools console showed the real cause plainly:

```
[Violation] Permissions policy violation: encrypted-media is not allowed in this document.
Encrypted Media access has been blocked because of a Feature Policy applied to the current document.
Uncaught (in promise) EMEError: No supported keysystem was found.
```

Spotify's own iframe correctly requests `allow="encrypted-media; autoplay"` (confirmed in the SDK source — `r.allow="encrypted-media; autoplay"` when it creates the iframe). But **Permissions Policy inherits down the iframe chain**: a nested iframe can only be granted a permission its ancestor frames already allow, regardless of what the nested iframe itself requests. Lightning Experience renders every app page inside a platform-controlled outer iframe that does not declare `allow="encrypted-media"` — not exposed anywhere in Setup, not something a permission set, CSP Trusted URL, or Apex change can reach. `connect()` still resolved `true` (the postMessage handshake itself succeeded) but no `ready` event or `device_id` ever followed — the messaging layer worked, the actual media session never could.

**Conclusion:** in-browser audio playback inside a standard Lightning Experience app page is not achievable — a browser-enforced restriction on Salesforce's own iframe architecture, not a gap in this build. The remote-control (Spotify Connect) architecture used throughout this integration is the correct design, not a fallback pending a better solution.

### Reusable takeaway

Any Salesforce LWC integration needing DRM-gated media (Spotify, or other EME-dependent audio/video SDKs) will hit this same wall. Check for an EME/`encrypted-media` dependency *before* investing in a CSP/token-exposure workaround — it alone rules out in-tab playback independent of everything else being solvable.

---

## Patterns demonstrated (reusable beyond Spotify)

| Pattern | Where |
|---|---|
| Per-user OAuth via External Credential (External Auth Identity Provider variant) | Setup chain above |
| Error-prefix contract (`NOT_CONNECTED`/`NO_DEVICE`/`RATE_LIMIT`) driving LWC UI state | `SpotifyPlayerService` + `spotifyHome.js` |
| Poll + local interpolation for a "live" UI over a pull-only API | Now-playing progress bar |
| Optimistic UI update on toggle actions | Play/Pause button |
| Routing `HttpCalloutMock` keyed by longest-matching endpoint substring | `SpotifyPlayerServiceTest.RoutingMock` |
| First-principles block map before committing to a costly architecture fork | Web Playback SDK decision |
