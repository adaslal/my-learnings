---
title: Named Credentials
---

# Named Credentials & External Credentials

## Modern model (Spring '23+)

```
External Credential  →  defines auth protocol + principals
Named Credential     →  references External Credential + sets endpoint URL
```

Apex always uses: `req.setEndpoint('callout:NamedCredentialName/path')` — same whether legacy or modern.

## External Credential fields

| Field | What it does |
|-------|-------------|
| Protocol | OAuth 2.0, JWT, Basic, Custom |
| Authentication Flow | Client Credentials / Authorization Code / JWT Bearer |
| Token URL | Where Salesforce fetches tokens |
| Client ID / Secret | Credentials for Client Credentials flow |
| Principal type | Named Principal (org-wide) or Per-User Principal (per user) |

## Named Principal vs Per-User Principal

| | Named Principal | Per-User Principal |
|--|-----------------|-------------------|
| Who gets the token | The org (one token shared) | Each user gets their own |
| Flow | Client Credentials / JWT | Authorization Code |
| Use case | System-to-system, no end user | API calls scoped to the individual user's permissions |
| Permission Set | Required — External Credential Principal Access | Required per user |

## Permission Set requirement (modern model)

```
External Credential Principal → must be assigned to a Permission Set
Permission Set → External Credential Principal Access → [your principal]
Assign that Permission Set to users/integrations needing callout access
```

Without this, callouts throw `Unauthorized` even if credentials are correct.

## Legacy Named Credential (pre-Spring '23)

```
Named Credential = auth + endpoint in one record
  → Auth: Password, OAuth, JWT, No Auth
  → Shared org-wide
  → Apex: req.setEndpoint('callout:LegacyNC/path')
```

Still works in orgs that haven't migrated. New orgs default to the modern split model.
