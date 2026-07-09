---
title: HubSpot Integration (OAuth Auth Code)
---

# Salesforce ↔ HubSpot Integration

## Overview

HubSpot uses **OAuth 2.0 Authorization Code Grant** — a 3-legged flow where a user approves access once, then Salesforce uses rotating refresh tokens indefinitely for background API calls.

**Why Authorization Code (not Client Credentials):** HubSpot's API scopes are user-delegated — they require a human to consent once, establishing which HubSpot portal this Salesforce org is connecting to. After that one-time consent, everything runs automatically.

## The key challenge: LWC can't receive OAuth redirects

HubSpot redirects back to a URI with the authorization code in the URL. LWC components run in the Lightning container — they can't be the redirect target. **Solution:** use a Visualforce page as the redirect URI. The VF page captures the code from the URL and passes it back to the LWC via URL parameters.

```
LWC → opens HubSpot auth URL → user approves → HubSpot redirects to VF page
 → VF page passes code back to LWC → LWC sends code to Apex → Apex exchanges code for tokens
```

## Architecture components

| Component | Role |
|-----------|------|
| `HubSpot_Config__mdt` | Custom Metadata Type — stores Client ID, Client Secret, Redirect URI. Deployable, no SOQL needed, survives sandbox refreshes. |
| `HubSpotOAuthTokens__c` | Custom Settings (Hierarchy) — stores access_token, refresh_token, expires_in per user. Fast access, modifiable at runtime. |
| `HubSpotTokenService` | Apex — manages token storage, reads/writes custom settings, handles refresh |
| `HubSpotAuthController` | Apex — LWC-facing controller, builds auth URL, triggers token exchange |
| `HubSpotApiService` | Apex — all HubSpot API calls (companies, contacts, etc.) |
| `HubspotRedirectPage` | Visualforce page — OAuth redirect target, captures code from URL |
| LWC component | UI — Auth button, data display, calls Apex controllers |

## Why Custom Metadata vs Custom Settings for different things

**Custom Metadata for config (Client ID, Secret, Redirect URI):**
- Deployable across environments in a package
- No SOQL needed — cached access in Apex
- Admins can change values without code
- Version-controlled with your org metadata

**Custom Settings (Hierarchy type) for tokens:**
- Per-user storage — each user has their own HubSpot connection
- Fast access without SOQL
- Modifiable at runtime by Apex (no deployment needed)
- `expires_in` tracked here so Apex knows when to refresh automatically

## OAuth flow step by step

```
1. User clicks "Connect to HubSpot" in LWC
2. LWC calls Apex to build auth URL:
   https://app.hubspot.com/oauth/authorize
     ?client_id={CLIENT_ID}
     &redirect_uri={VF_PAGE_URL}
     &scope=contacts%20companies
     &response_type=code
3. User is redirected to HubSpot login → approves access
4. HubSpot redirects to VF page:
   https://YOUR_ORG.vf.force.com/apex/HubspotRedirectPage?code=ABC123
5. VF page reads code from URL → posts to LWC (or navigates with code in URL)
6. LWC sends code to Apex controller
7. Apex POSTs to HubSpot token endpoint:
   POST https://api.hubapi.com/oauth/v1/token
   grant_type=authorization_code
   code=ABC123
   client_id=...
   client_secret=...
   redirect_uri=...
8. HubSpot returns { access_token, refresh_token, expires_in }
9. Apex stores tokens in Custom Settings
10. All future API calls use the stored access_token
    When it expires: Apex auto-refreshes using refresh_token
```

## Automatic token refresh pattern

```apex
public class HubSpotTokenService {
    public static String getValidToken() {
        HubSpotOAuthTokens__c tokens = HubSpotOAuthTokens__c.getInstance();
        if (tokens == null || String.isBlank(tokens.Access_Token__c)) {
            throw new HubSpotException('Not authenticated — user must complete OAuth flow first');
        }
        // Check if token expires within 5 minutes
        if (tokens.Token_Expiry__c != null && tokens.Token_Expiry__c <= Datetime.now().addMinutes(5)) {
            return refreshToken(tokens.Refresh_Token__c);
        }
        return tokens.Access_Token__c;
    }

    private static String refreshToken(String refreshToken) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:HubSpotNC/oauth/v1/token');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody('grant_type=refresh_token&refresh_token=' + refreshToken
            + '&client_id=' + HubSpot_Config__mdt.getInstance('Default').Client_Id__c
            + '&client_secret=' + HubSpot_Config__mdt.getInstance('Default').Client_Secret__c);
        HttpResponse res = new Http().send(req);
        Map<String,Object> body = (Map<String,Object>) JSON.deserializeUntyped(res.getBody());
        // Store new tokens
        HubSpotOAuthTokens__c tokens = HubSpotOAuthTokens__c.getInstance() ?? new HubSpotOAuthTokens__c();
        tokens.Access_Token__c = (String) body.get('access_token');
        tokens.Token_Expiry__c = Datetime.now().addSeconds(((Integer) body.get('expires_in')) - 60);
        upsert tokens;
        return tokens.Access_Token__c;
    }
}
```

## Fetching HubSpot data

```apex
// After auth is complete, all calls follow this pattern:
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:HubSpotNC/crm/v3/objects/companies?limit=10');
req.setMethod('GET');
req.setHeader('Authorization', 'Bearer ' + HubSpotTokenService.getValidToken());
HttpResponse res = new Http().send(req);
```

## Remote Site Settings required

- `https://api.hubapi.com` — HubSpot REST API
- `https://app.hubspot.com` — HubSpot OAuth authorization endpoint

## Key design decisions

**Use Custom Metadata for config, Custom Settings for runtime state** — don't mix these. Config (client ID, redirect URI) never changes at runtime; tokens do.

**Never store secrets as Apex constants** — `Client_Secret__c` lives in Custom Metadata, encrypted at rest by Salesforce.

**The VF page redirect pattern is mandatory** — LWC cannot be an OAuth redirect URI. This is a Lightning container limitation, not a HubSpot limitation. Same pattern applies to any OAuth 3LO flow from Salesforce UI.
