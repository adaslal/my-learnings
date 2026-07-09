---
title: ServiceNow Integration (PKCE)
---

# Salesforce ↔ ServiceNow Integration

## Authentication: OAuth 2.0 Authorization Code with PKCE

PKCE (Proof Key for Code Exchange, pronounced "pixy") — an OAuth 2.0 extension that prevents authorization code interception attacks. Required when the client (LWC) cannot securely store a client secret.

## Why PKCE instead of standard Authorization Code?

Standard Authorization Code flow has a problem: the `code` returned via URL redirect can be intercepted (browser history, referrer headers, malicious redirects). Anyone who intercepts the code can exchange it for tokens if they have the client secret.

PKCE adds a cryptographic binding between the authorization request and the token request:

1. Client generates a random `code_verifier` (43–128 chars, never sent to the auth server during step 1)
2. Client computes `code_challenge = SHA256(code_verifier)` — sends only the hash
3. Auth server stores the hash
4. When exchanging the code for tokens, client sends the original `code_verifier`
5. Auth server verifies `SHA256(code_verifier) == stored_challenge` — proves it's the same client

**Even if an attacker intercepts the auth code, they can't use it** — they don't have the `code_verifier` that was generated locally and never transmitted.

## Complete PKCE flow

```
CLIENT (LWC/Apex)                          SERVICENOW (OAuth Server)
─────────────────────────────────────────────────────────────────
1. Generate code_verifier (random, 43+ chars)
2. Compute code_challenge = SHA256(verifier)
3. Generate random state (CSRF protection)
4. Store verifier + state in sessionStorage

AUTHORIZATION REQUEST →
GET /oauth_auth.do
  ?response_type=code
  &client_id=xxx
  &redirect_uri=xxx
  &state=random123
  &code_challenge=sha256_hash_here
  &code_challenge_method=S256

                              [User logs in & approves]
                              [ServiceNow stores code_challenge]

← REDIRECT WITH CODE
  ?code=authcode123&state=random123

5. Validate state matches stored value
6. Retrieve code_verifier from sessionStorage

TOKEN REQUEST →
POST /oauth_token.do
  grant_type=authorization_code
  code=authcode123
  code_verifier=original_random_string   ← this proves identity
  client_id=xxx
  client_secret=yyy (or omit for public clients)

                              [ServiceNow computes SHA256(code_verifier)]
                              [Verifies it matches stored challenge]

← ACCESS TOKEN (if verified)
  { access_token, refresh_token, expires_in }
```

## PKCE vs standard auth code — use case comparison

| | PKCE | Standard Auth Code |
|--|------|-------------------|
| Client secret required | No (optional) | Yes |
| Safe for public clients (SPAs, mobile) | Yes | No — secret would be exposed |
| Safe for server-side (Apex) | Yes (adds extra protection) | Yes |
| Prevents code interception | Yes | No |
| Use when | LWC/SPA initiates OAuth | Server-side only flows |

## Same LWC → VF page redirect pattern applies

ServiceNow redirects back to a URI with the code. LWC can't be the redirect target (Lightning container limitation). Use a Visualforce page as the redirect URI — same pattern as HubSpot:

```
LWC generates PKCE params → opens ServiceNow auth URL
→ user approves → ServiceNow redirects to VF page
→ VF page passes code + state to LWC
→ LWC validates state, retrieves code_verifier
→ LWC calls Apex with code + verifier
→ Apex exchanges code for tokens (server-to-server)
```

## ServiceNow-specific setup

ServiceNow OAuth App setup (in ServiceNow):
- Application Registry → New → "Create an OAuth API endpoint for external clients"
- Set Redirect URL to your VF page URL
- Note Client ID and Client Secret

## What this integration enables

Once authenticated:
- Create Incidents in ServiceNow from Salesforce Cases
- Pull Incident status into Salesforce (change request tracking)
- Sync Configuration Items ↔ Salesforce Assets
- Trigger ServiceNow workflows from Salesforce automation

Custom object pattern: `ServiceNow_Incident__c` with `SN_Incident_Number__c` as External ID, Upsert to keep records in sync.
