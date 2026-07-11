---
title: S2S Client Credentials — Gotchas
---

# Salesforce-to-Salesforce: Client Credentials Flow

## Architecture

One Salesforce org (caller) authenticates into another Salesforce org (target) using OAuth 2.0 Client Credentials. No user interaction at runtime — the caller org's Apex gets a token and makes REST API calls directly.

```
Caller Org (Apex)
  → External Credential (Client Credentials protocol)
  → Named Credential (endpoint: target org domain)
  → HTTP callout → Target Org REST API
```

**Target org setup:** External Client App → OAuth Scopes → Consumer Key + Secret → Integration User assigned as the Run As user via External Client App Policies.

**Caller org setup:** External Credential (Protocol: OAuth 2.0, Flow: Client Credentials) → Named Credential → Permission Set with External Credential Principal Access → assigned to the running user or integration user.

---

## 4 Gotchas from a Real Setup — Learn These Before They Cost You an Hour

### Gotcha 1 — Integration User can't be assigned a Permission Set

**Error:**
```
Can't assign permission set "Integration Account Read" to user "Integration User".
The user license doesn't allow the permission: Read Accounts
```

**Cause:** The free **Salesforce Integration** user license gates standard-object permissions (Read Accounts, etc.) behind a companion **Permission Set License** (`SalesforceAPIIntegrationPsl`) that isn't assigned by default. The PSL is the gatekeeper — without it, the user license blocks even basic object permissions in a permission set.

**Fix:**
1. Go to the Integration User's record
2. Permission Set License Assignments (related list) → Edit Assignments
3. Assign **"Salesforce API Integration"** PSL
4. Now assign the permission set — it goes through

**Remember:** On any fresh Integration User, assign the PSL first before touching permission sets.

---

### Gotcha 2 — `System.CalloutException: Method can not be null`

**Error:**
```
System.CalloutException: Method can not be null
```

**Cause:** `req.setEndpoint()` was accidentally called twice. The second call (intended to be `setMethod('GET')`) overwrote the endpoint instead, leaving `Method` entirely unset:

```apex
// BROKEN — setEndpoint called twice, setMethod never called
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:TargetOrgNC/services/data/v60.0/sobjects/Account/describe');
req.setEndpoint('GET');  // ← this is the bug — should be setMethod
HttpResponse res = new Http().send(req);
```

**Fix:**
```apex
HttpRequest req = new HttpRequest();
req.setEndpoint('callout:TargetOrgNC/services/data/v60.0/sobjects/Account/describe');
req.setMethod('GET');  // ← correct
HttpResponse res = new Http().send(req);
```

**Why the error message is confusing:** "Method can not be null" sounds like a null reference error. It's actually the HTTP method (GET/POST/etc.) that's missing — the platform literally has no method to send.

---

### Gotcha 3 — `invalid_request: scope parameter not supported` ⚠️

**Error:**
```
{"error":"invalid_request","error_description":"scope parameter not supported"}
```

**Cause:** The External Credential had a `Scope` field set (e.g., `api`). Salesforce's OAuth **token endpoint** doesn't accept a `scope` parameter at all — it's only valid on the authorization endpoint in other flows (Authorization Code, etc.). This is a known, longstanding Salesforce API quirk that isn't well-documented.

The token endpoint for Client Credentials (`/services/oauth2/token`) silently ignores many parameters but explicitly rejects `scope`.

**Fix:** Clear the `Scope` field on the External Credential entirely — leave it blank.

The scope restriction is already enforced upstream via the **External Client App's OAuth Scopes** setting in the target org. Clearing the External Credential scope field loses nothing — the constraint lives in the right place.

**Why this is worth writing down:** The error message doesn't say "remove scope from External Credential" — it says scope isn't supported, which sounds like your token endpoint URL is wrong or the app doesn't support the flow. You'll spend time questioning the wrong thing.

---

### Gotcha 4 — 404 on the actual callout

**Error:**
```
HTTP/1.1 404 Not Found
```

**Cause:** API version formatted as `v60` instead of `v60.0`. Salesforce REST API versions require the decimal point.

```apex
// WRONG
req.setEndpoint('callout:TargetOrgNC/services/data/v60/sobjects/Account/describe');

// CORRECT
req.setEndpoint('callout:TargetOrgNC/services/data/v60.0/sobjects/Account/describe');
```

**Fix:** Always write API versions with the decimal: `v60.0`, `v61.0`, not `v60`, `v61`.

---

## End result — working Apex

```apex
public class TargetOrgCallout {
    public static void describeAccount() {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:TargetOrgNC/services/data/v60.0/sobjects/Account/describe');
        req.setMethod('GET');
        HttpResponse res = new Http().send(req);
        System.debug(res.getStatusCode() + ' ' + res.getBody());
    }
}
```

**Expected output:** `200 OK` with full Account describe JSON.

---

## Setup checklist (target org)

- [ ] External Client App created → OAuth enabled → "Enable Client Credentials Flow" checked
- [ ] Consumer Key and Consumer Secret noted
- [ ] OAuth Scopes set (e.g., `api`, `refresh_token`)
- [ ] Client Credentials Flow: Run As User set to your Integration User
- [ ] Integration User has correct Permission Sets (and PSL assigned first — see Gotcha 1)

## Setup checklist (caller org)

- [ ] External Credential: Protocol = OAuth 2.0, Flow = Client Credentials, Token URL = `https://target-org.my.salesforce.com/services/oauth2/token`, Client ID + Secret from target org, **Scope = blank** (see Gotcha 3)
- [ ] Named Credential: references the External Credential, Endpoint = `https://target-org.my.salesforce.com`
- [ ] Permission Set: External Credential Principal Access granted for this credential
- [ ] Permission Set assigned to the user running the Apex
- [ ] Apex: `req.setEndpoint('callout:NamedCredentialName/services/data/v60.0/...')` — note the `/services/data/` path appended after the NC name
- [ ] API version uses decimal format: `v60.0` not `v60` (see Gotcha 4)
