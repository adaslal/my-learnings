---
title: Spotify Integration (Client Credentials)
---

# Salesforce → Spotify Integration (Client Credentials)

Calls the Spotify Web API from Apex using OAuth 2.0 Client Credentials — no user login required. Demonstrates the **HTTP Basic auth variant** of Client Credentials that many external APIs use (as opposed to the body-params variant Salesforce uses).

## What makes Spotify's token endpoint different

Most Client Credentials implementations send `client_id` and `client_secret` as POST body params. Spotify requires **HTTP Basic auth** — the credentials go in the `Authorization` header as `Basic base64(client_id:client_secret)`:

```
POST /api/token
Authorization: Basic base64("client_id:client_secret")
Content-Type: application/x-www-form-urlencoded
Body: grant_type=client_credentials
```

This is the same `Authorization: Basic` scheme you'd use for username/password HTTP auth — just with your app's key pair instead.

## Auth — SpotifyAuthService

```apex
public with sharing class SpotifyAuthService {

    private static final String CLIENT_ID     = 'YOUR_SPOTIFY_CLIENT_ID';
    private static final String CLIENT_SECRET = 'YOUR_SPOTIFY_CLIENT_SECRET';
    private static final String TOKEN_ENDPOINT = 'callout:Spotify_Accounts/api/token';

    public class AuthException extends Exception {}

    public static String getAccessToken() {
        // Spotify requires credentials as HTTP Basic, not body params
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
            throw new AuthException(
                'Spotify auth failed [' + res.getStatusCode() + ']: ' + res.getBody()
            );
        }

        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        return (String) body.get('access_token');
    }
}
```

## API calls — SpotifyService

Token is obtained fresh per transaction. In production, cache it in **Platform Cache** for up to 1 hour (Spotify tokens are valid for 3600s):

```apex
public with sharing class SpotifyService {

    private static final String BASE_URL = 'callout:Spotify_API';

    // Inner classes for typed responses returned to LWC
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
        @AuraEnabled public Boolean isExplicit;
    }

    public class SearchResult {
        @AuraEnabled public List<Artist> artists;
        @AuraEnabled public List<Track>  tracks;
        @AuraEnabled public List<Album>  albums;
    }

    @AuraEnabled
    public static SearchResult search(String query, Integer limit) {
        String token   = SpotifyAuthService.getAccessToken();
        String encoded = EncodingUtil.urlEncode(query, 'UTF-8');
        String path    = '/v1/search?q=' + encoded + '&type=artist,track,album&limit=' + limit;

        HttpRequest req = new HttpRequest();
        req.setEndpoint(BASE_URL + path);
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + token);
        req.setTimeout(20000);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new AuraHandledException('Search failed: ' + res.getBody());
        }

        return parseSearchResponse(res.getBody());
    }

    // Parse nested JSON into typed inner class objects
    private static SearchResult parseSearchResponse(String body) {
        Map<String, Object> root   = (Map<String, Object>) JSON.deserializeUntyped(body);
        SearchResult result = new SearchResult();

        // Artists
        Map<String, Object> artistsBlock = (Map<String, Object>) root.get('artists');
        List<Object> artistItems = (List<Object>) artistsBlock.get('items');
        result.artists = new List<Artist>();
        for (Object item : artistItems) {
            Map<String, Object> a = (Map<String, Object>) item;
            Artist artist         = new Artist();
            artist.id             = (String)  a.get('id');
            artist.name           = (String)  a.get('name');
            artist.popularity     = (Integer) a.get('popularity');
            Map<String, Object> followers = (Map<String, Object>) a.get('followers');
            artist.followerCount  = (Integer) followers.get('total');
            artist.genres         = (List<String>) a.get('genres');
            result.artists.add(artist);
        }
        return result;
    }
}
```

## Named Credentials setup

Two Named Credentials — one for auth, one for API:

| Name | URL | Auth Protocol |
|------|-----|---------------|
| `Spotify_Accounts` | `https://accounts.spotify.com` | No Authentication |
| `Spotify_API` | `https://api.spotify.com` | No Authentication |

Auth is handled manually in Apex (HTTP Basic for token, Bearer for API calls).

## Client Credentials comparison: Spotify vs Salesforce

| | Spotify | Salesforce (External Credential) |
|--|---------|----------------------------------|
| **client_id delivery** | `Authorization: Basic base64(id:secret)` header | POST body param |
| **client_secret delivery** | Same Basic header | POST body param |
| **grant_type body** | `grant_type=client_credentials` | `grant_type=client_credentials` |
| **Scope param** | Not needed (public data) | Leave blank — Salesforce token endpoint rejects `scope` |
| **Token TTL** | 3600 seconds | Varies |

## Client Credentials vs JWT Bearer

| | Client Credentials | JWT Bearer |
|--|---|---|
| **Auth** | Client ID + Secret | Signed JWT (RS256) |
| **Token endpoint** | `grant_type=client_credentials` | `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer` |
| **Setup complexity** | Low — just an app key pair | High — RSA key pair, certificate |
| **Best for** | External APIs (Spotify, Slack, etc.) | Google Service Accounts, Salesforce-to-Salesforce |
| **User context** | None — machine identity | None — service account identity |

## Test from Execute Anonymous

```apex
// Search
SpotifyService.SearchResult r = SpotifyService.search('A.R. Rahman', 5);
for (SpotifyService.Artist a : r.artists) {
    System.debug(a.name + ' | Popularity: ' + a.popularity + ' | Followers: ' + a.followerCount);
}

// Get top tracks for an artist (find ID first)
SpotifyService.SearchResult s = SpotifyService.search('Daft Punk', 1);
String artistId = s.artists[0].id;
List<SpotifyService.Track> topTracks = SpotifyService.getArtistTopTracks(artistId, 'IN');
for (SpotifyService.Track t : topTracks) {
    System.debug(t.name + ' | ' + t.durationSeconds + 's | Popularity: ' + t.popularity);
}
```
