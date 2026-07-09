---
title: OAuth Flows
---

# OAuth 2.0 Flows in Salesforce

## Flow Comparison

| Flow | Who authenticates | Use case | Salesforce setup |
|------|-------------------|----------|------------------|
| **Client Credentials** | App itself (client_id + secret) | System-to-system, no user | External Credential → Named Principal |
| **JWT Bearer** | App, signed JWT assertion | Server-to-server (stronger than client_secret) | External Client App → digital certificate |
| **Authorization Code** | User logs in, grants consent | Per-user auth | External Credential → Per-User Principal |

## The key mental model

Two completely separate concerns — don't conflate them:

1. **What triggers your Apex** — always a real entry point: button click → LWC `onclick` → `@AuraEnabled` method, a Screen Flow action, a record-triggered Flow/trigger, a scheduled/batch job, or an inbound REST call. Apex never runs on its own.

2. **How the OAuth token is obtained** — handled entirely by the Named Credential / External Credential layer, silently, the moment Apex makes a callout. You never write token-fetching code. Salesforce checks for a cached valid token; if expired or absent, it silently exchanges credentials for a new one, then forwards your request with the Bearer header attached.

## Client Credentials setup (Salesforce side)

```
Setup → Named Credentials → External Credentials
  → Protocol: OAuth 2.0
  → Flow: Client Credentials
  → Client ID: [from external system]
  → Client Secret: [from external system]
  → Token URL: https://api.example.com/oauth/token
  → Principal: Named Principal (org-wide)
  → Grant permission via Permission Set → External Credential Principal Access
```

```apex
// Apex callout — token injected automatically, you never see it
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:MyExternalCred/api/resource');
req.setMethod('GET');
HttpResponse res = new Http().send(req);
```

## JWT Bearer setup (external system calling INTO Salesforce)

Setup phase (one-time, done by a human):

1. Generate a public/private key pair. The **private key stays with whoever will sign** the JWT.
2. Salesforce admin: Setup → **External Client App Manager** → New External Client App → enable OAuth → check **"Use digital signatures"** → upload the **public certificate** (.crt).
3. Note the **Consumer Key** — goes into the JWT's `iss` claim.
4. Create a dedicated integration user for the `sub` claim, locked down via Permission Set.

JWT claims:
```json
{
  "iss": "<External Client App Consumer Key>",
  "sub": "integration.user@yourorg.com",
  "aud": "https://login.salesforce.com",
  "exp": 1751000000
}
```

The external system signs the JWT → POSTs to Salesforce's token endpoint → Salesforce verifies signature against the uploaded cert → issues `access_token`.

**Why JWT > Client Credentials:** No shared secret ever transmitted. A signature proves possession of the private key — nothing to leak and replay.

## Authorization Code (per-user)

```
External Credential → Per-User Principal
User clicks "Authenticate" → browser redirects to external login →
user consents → Salesforce stores token per user →
subsequent callouts use that user's token automatically
```
