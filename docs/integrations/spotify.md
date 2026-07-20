---
title: Spotify Integration (Client Credentials)
---

# Salesforce → Spotify Integration (Client Credentials)

Calls the Spotify Web API from Apex using OAuth 2.0 Client Credentials — no user login required. Also demonstrates a **direct `fetch()` from LWC JavaScript**, which works for public APIs that have CORS headers.

---

## Two callout approaches — know both

| | Standard: LWC → Apex → External API | Direct: LWC `fetch()` → External API |
|--|---|---|
| **How** | LWC calls `@AuraEnabled` Apex method; Apex makes HTTP callout | LWC JavaScript calls `fetch()` or `XMLHttpRequest` directly |
| **When** | Any integration (default approach) | Only for public APIs with `Access-Control-Allow-Origin: *` CORS headers |
| **Apex involved?** | Yes — all HTTP logic in Apex | No — but you still need an Apex method to get the token securely |
| **CORS required?** | No — Apex runs server-side | Yes — browser enforces CORS |
| **Named Credential** | Yes — externalizes URL + auth | Not applicable |
| **Can expose secrets?** | No — client secret stays in Apex | ⚠️ Never put client secret in LWC JS — it ships to the browser |

**Rule:** Use Apex → External API for any API with a client secret. Use `fetch()` from LWC only for public read APIs (like Spotify search) where the access token alone is enough, and get that token from Apex first.

---

## What makes Spotify's token endpoint different

Spotify requires **HTTP Basic auth** for the token request — credentials in the `Authorization` header as `Basic base64(client_id:client_secret)`:

```
POST /api/token
Authorization: Basic base64("client_id:client_secret")
Content-Type: application/x-www-form-urlencoded
Body: grant_type=client_credentials
```

Most Client Credentials flows send `client_id` and `client_secret` as POST body params. Spotify is an exception.

---

## Apex — SpotifyAuthService

```apex
public with sharing class SpotifyAuthService {

    private static final String CLIENT_ID     = 'YOUR_SPOTIFY_CLIENT_ID';
    private static final String CLIENT_SECRET = 'YOUR_SPOTIFY_CLIENT_SECRET';
    private static final String TOKEN_ENDPOINT = 'callout:Spotify_Accounts/api/token';

    public class AuthException extends Exception {}

    public static String getAccessToken() {
        // HTTP Basic: base64(client_id:client_secret) in Authorization header
        String credentials = CLIENT_ID + ':' + CLIENT_SECRET;
        String basicAuth   = 'Basic ' + EncodingUtil.base64Encode(Blob.valueOf(credentials));

        HttpRequest req = new HttpRequest();
        req.setEndpoint(TOKEN_ENDPOINT);
        req.setMethod('POST');
        req.setHeader('Authorization', basicAuth);
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody('grant_type=client_credentials');
        req.setTimeout(15000);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new AuthException('Spotify auth failed [' + res.getStatusCode() + ']: ' + res.getBody());
        }

        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        return (String) body.get('access_token');
    }
}
```

---

## Apex — SpotifyController (LWC-facing)

```apex
public with sharing class SpotifyController {

    private static final String BASE_URL = 'callout:Spotify_API';

    public class Artist {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public Integer popularity;
        @AuraEnabled public Integer followerCount;
        @AuraEnabled public List<String> genres;
    }

    public class Track {
        @AuraEnabled public String id;
        @AuraEnabled public String name;
        @AuraEnabled public String artistNames;
        @AuraEnabled public String albumName;
        @AuraEnabled public Integer durationSeconds;
        @AuraEnabled public Integer popularity;
    }

    public class SearchResult {
        @AuraEnabled public List<Artist> artists = new List<Artist>();
        @AuraEnabled public List<Track>  tracks  = new List<Track>();
    }

    @AuraEnabled
    public static SearchResult search(String query, Integer limitCount) {
        String token = SpotifyAuthService.getAccessToken();
        String path  = '/v1/search?q=' + EncodingUtil.urlEncode(query, 'UTF-8')
                     + '&type=artist,track&limit=' + limitCount;

        HttpRequest req = new HttpRequest();
        req.setEndpoint(BASE_URL + path);
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + token);
        req.setTimeout(20000);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new AuraHandledException('Search failed: ' + res.getBody());
        }

        return parseSearchResult(res.getBody());
    }

    @AuraEnabled
    public static String getAccessTokenForLwc() {
        // Returns just the token — LWC will use it in a direct fetch()
        // The client secret stays in Apex; only the time-limited token goes to the browser
        return SpotifyAuthService.getAccessToken();
    }

    private static SearchResult parseSearchResult(String body) {
        Map<String, Object> root = (Map<String, Object>) JSON.deserializeUntyped(body);
        SearchResult result = new SearchResult();

        // Parse artists
        Map<String, Object> artistsBlock = (Map<String, Object>) root.get('artists');
        List<Object> artistItems = (List<Object>) artistsBlock.get('items');
        for (Object item : artistItems) {
            Map<String, Object> a = (Map<String, Object>) item;
            Artist artist         = new Artist();
            artist.id             = (String)  a.get('id');
            artist.name           = (String)  a.get('name');
            artist.popularity     = (Integer) a.get('popularity');
            Map<String, Object> followers = (Map<String, Object>) a.get('followers');
            artist.followerCount  = (Integer) followers.get('total');
            artist.genres         = new List<String>();
            for (Object g : (List<Object>) a.get('genres')) {
                artist.genres.add((String) g);
            }
            result.artists.add(artist);
        }

        // Parse tracks
        Map<String, Object> tracksBlock = (Map<String, Object>) root.get('tracks');
        List<Object> trackItems = (List<Object>) tracksBlock.get('items');
        for (Object item : trackItems) {
            Map<String, Object> t = (Map<String, Object>) item;
            Track track           = new Track();
            track.id              = (String)  t.get('id');
            track.name            = (String)  t.get('name');
            track.durationSeconds = ((Integer) t.get('duration_ms')) / 1000;
            track.popularity      = (Integer) t.get('popularity');
            // Artist names (can be multiple)
            List<Object> artists = (List<Object>) t.get('artists');
            List<String> names   = new List<String>();
            for (Object a : artists) {
                names.add((String)((Map<String, Object>) a).get('name'));
            }
            track.artistNames = String.join(names, ', ');
            Map<String, Object> album = (Map<String, Object>) t.get('album');
            track.albumName   = (String) album.get('name');
            result.tracks.add(track);
        }
        return result;
    }
}
```

---

## LWC — Approach 1: Standard LWC → Apex → Spotify

The normal Salesforce integration pattern. Apex handles everything; LWC just calls and displays.

### HTML

```html
<template>
    <lightning-card title="Spotify Search" icon-name="standard:music">
        <div class="slds-p-around_medium">

            <!-- Search bar -->
            <div class="slds-grid slds-gutters slds-m-bottom_medium">
                <div class="slds-col slds-size_3-of-4">
                    <lightning-input
                        label="Search Spotify"
                        placeholder="Artist, song, or album..."
                        value={searchQuery}
                        onchange={handleQueryChange}>
                    </lightning-input>
                </div>
                <div class="slds-col slds-size_1-of-4 slds-align-bottom">
                    <lightning-button
                        variant="brand"
                        label="Search"
                        onclick={handleSearch}
                        disabled={isLoading}>
                    </lightning-button>
                </div>
            </div>

            <!-- Spinner -->
            <template lwc:if={isLoading}>
                <div class="slds-align_absolute-center slds-p-around_medium">
                    <lightning-spinner alternative-text="Searching Spotify" size="small"></lightning-spinner>
                </div>
            </template>

            <!-- Error -->
            <template lwc:if={error}>
                <div class="slds-notify slds-notify_alert slds-alert_error" role="alert">
                    {error}
                </div>
            </template>

            <!-- Artists results -->
            <template lwc:if={hasArtists}>
                <h3 class="slds-text-heading_small slds-m-bottom_x-small">Artists</h3>
                <table class="slds-table slds-table_cell-buffer slds-table_bordered slds-m-bottom_medium">
                    <thead>
                        <tr>
                            <th><div class="slds-truncate">Name</div></th>
                            <th><div class="slds-truncate">Popularity</div></th>
                            <th><div class="slds-truncate">Followers</div></th>
                            <th><div class="slds-truncate">Genres</div></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template for:each={artists} for:item="a">
                            <tr key={a.id}>
                                <td><div class="slds-truncate">{a.name}</div></td>
                                <td><div class="slds-truncate">{a.popularity}</div></td>
                                <td><div class="slds-truncate">{a.followerCount}</div></td>
                                <td><div class="slds-truncate">{a.genreList}</div></td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </template>

            <!-- Tracks results -->
            <template lwc:if={hasTracks}>
                <h3 class="slds-text-heading_small slds-m-bottom_x-small">Tracks</h3>
                <table class="slds-table slds-table_cell-buffer slds-table_bordered">
                    <thead>
                        <tr>
                            <th><div class="slds-truncate">Track</div></th>
                            <th><div class="slds-truncate">Artist(s)</div></th>
                            <th><div class="slds-truncate">Album</div></th>
                            <th><div class="slds-truncate">Duration</div></th>
                            <th><div class="slds-truncate">Popularity</div></th>
                        </tr>
                    </thead>
                    <tbody>
                        <template for:each={tracks} for:item="t">
                            <tr key={t.id}>
                                <td><div class="slds-truncate">{t.name}</div></td>
                                <td><div class="slds-truncate">{t.artistNames}</div></td>
                                <td><div class="slds-truncate">{t.albumName}</div></td>
                                <td><div class="slds-truncate">{t.durationFormatted}</div></td>
                                <td><div class="slds-truncate">{t.popularity}</div></td>
                            </tr>
                        </template>
                    </tbody>
                </table>
            </template>

            <!-- Empty state -->
            <template lwc:if={showEmpty}>
                <p class="slds-text-color_weak slds-text-align_center slds-p-around_medium">
                    No results yet. Try searching for an artist or song.
                </p>
            </template>

        </div>
    </lightning-card>
</template>
```

### JavaScript (Standard: Apex handles the callout)

```javascript
import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import searchSpotify from '@salesforce/apex/SpotifyController.search';

export default class SpotifySearch extends LightningElement {

    searchQuery  = '';
    isLoading    = false;
    error        = null;
    _artists     = [];
    _tracks      = [];

    get artists()    { return this._artists; }
    get tracks()     { return this._tracks; }
    get hasArtists() { return this._artists.length > 0; }
    get hasTracks()  { return this._tracks.length > 0; }
    get showEmpty()  { return !this.isLoading && !this.hasArtists && !this.hasTracks; }

    handleQueryChange(event) {
        this.searchQuery = event.target.value;
    }

    async handleSearch() {
        if (!this.searchQuery.trim()) return;
        this.isLoading = true;
        this.error     = null;
        this._artists  = [];
        this._tracks   = [];
        try {
            // LWC calls Apex imperatively → Apex calls Spotify → result returned
            const result = await searchSpotify({ query: this.searchQuery, limitCount: 5 });
            this._artists = result.artists.map(a => ({
                ...a,
                genreList: (a.genres || []).join(', ') || '—'
            }));
            this._tracks = result.tracks.map(t => ({
                ...t,
                durationFormatted: this._formatDuration(t.durationSeconds)
            }));
        } catch (err) {
            this.error = err?.body?.message || err?.message || 'Search failed';
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: this.error, variant: 'error' }));
        } finally {
            this.isLoading = false;
        }
    }

    _formatDuration(totalSeconds) {
        if (!totalSeconds) return '—';
        const mins = Math.floor(totalSeconds / 60);
        const secs = String(totalSeconds % 60).padStart(2, '0');
        return `${mins}:${secs}`;
    }
}
```

---

## LWC — Approach 2: Direct `fetch()` from LWC JavaScript

:::info When to use this
Spotify's API endpoints support CORS (`Access-Control-Allow-Origin: *`), so the browser can call them directly. The **token** still comes from Apex (to keep the client secret server-side), but the actual search `fetch()` happens in LWC JavaScript.
:::

```javascript
import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getAccessToken from '@salesforce/apex/SpotifyController.getAccessTokenForLwc';

export default class SpotifyDirectFetch extends LightningElement {

    searchQuery = '';
    isLoading   = false;
    error       = null;
    results     = [];

    handleQueryChange(event) {
        this.searchQuery = event.target.value;
    }

    async handleSearch() {
        if (!this.searchQuery.trim()) return;
        this.isLoading = true;
        this.error     = null;
        this.results   = [];

        try {
            // Step 1: Get access token from Apex (client secret never leaves the server)
            const token = await getAccessToken();

            // Step 2: Call Spotify directly from LWC using fetch()
            //         This works because Spotify's API has CORS headers
            const encoded = encodeURIComponent(this.searchQuery);
            const url     = `https://api.spotify.com/v1/search?q=${encoded}&type=artist,track&limit=5`;

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error(`Spotify API error: ${response.status}`);
            }

            const data = await response.json();

            // Step 3: Parse and display
            const artists = (data.artists?.items || []).map(a => ({
                id:       a.id,
                name:     a.name,
                type:     'Artist',
                subtitle: `${a.followers?.total?.toLocaleString()} followers`
            }));
            const tracks = (data.tracks?.items || []).map(t => ({
                id:       t.id,
                name:     t.name,
                type:     'Track',
                subtitle: `${t.artists.map(x => x.name).join(', ')} — ${t.album.name}`
            }));

            this.results = [...artists, ...tracks];

        } catch (err) {
            this.error = err.message || 'Search failed';
            this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: this.error, variant: 'error' }));
        } finally {
            this.isLoading = false;
        }
    }
}
```

### Why the token still comes from Apex

```
Client Secret  →  NEVER goes to browser
                    stays in Apex (SpotifyAuthService.getAccessToken())
                    Apex returns only the time-limited access_token (1 hour TTL)

LWC receives:  access_token  →  uses in Authorization: Bearer header on fetch()
```

If you put `CLIENT_SECRET` in the LWC JavaScript file, it ships to every browser that loads the page. Anyone can open DevTools and read it. The Apex → LWC token handoff keeps the secret server-side.

---

## Named Credentials setup

| Name | URL |
|------|-----|
| `Spotify_Accounts` | `https://accounts.spotify.com` |
| `Spotify_API` | `https://api.spotify.com` |

Both use **No Authentication** — auth is handled manually in Apex.

---

## Client Credentials comparison: body params vs HTTP Basic

| | Salesforce / most APIs | Spotify |
|--|---|---|
| **client_id** | POST body param | `Authorization: Basic base64(id:secret)` header |
| **client_secret** | POST body param | Same Basic header |
| **grant_type body** | `grant_type=client_credentials` | `grant_type=client_credentials` |

---

## LWC patterns demonstrated

| Pattern | Where |
|---------|-------|
| **Imperative Apex call** | `await searchSpotify({ query, limitCount })` |
| **Direct `fetch()` from LWC** | Approach 2 — browser calls Spotify API directly with token from Apex |
| **Apex token bridge** | `getAccessTokenForLwc()` — secret stays server-side, only token crosses to browser |
| **Computed getters** | `hasArtists`, `hasTracks`, `showEmpty` — keep template logic clean |
| **`async/await` with `try/finally`** | `isLoading = false` always runs even on error |
| **Spread into display shape** | `{ ...a, genreList: ... }` — adds display fields without mutating the Apex result |
