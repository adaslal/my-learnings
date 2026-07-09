---
title: SharePoint Integration (Client Credentials + Graph API)
---

# Salesforce ↔ SharePoint Integration

## Authentication: OAuth 2.0 Client Credentials via Azure AD

SharePoint Online is owned by Microsoft — auth goes through **Azure Active Directory**, not SharePoint directly. The Microsoft Graph API is the single entry point for all Microsoft 365 data including SharePoint and OneDrive.

**Why Client Credentials:** Salesforce accesses organizational SharePoint data without a specific user's context. The application itself has permission to access all sites — ideal for scheduled jobs, batch processes, and org-wide integrations.

## Azure AD setup (one-time, done by admin)

1. Azure portal → Azure Active Directory → App registrations → New registration
2. Note the **Application (client) ID** and **Directory (tenant) ID**
3. Certificates & Secrets → New client secret → note the secret value
4. API Permissions → Add → Microsoft Graph → Application permissions:
   - `Sites.Read.All` (read SharePoint sites)
   - `Files.ReadWrite.All` (read/write files)
   - `Sites.ReadWrite.All` (if writing to SharePoint)
5. **Grant admin consent** for the tenant (required for Application permissions — cannot be user-delegated)

## Token request from Salesforce Apex

```apex
public class SharePointAuthService {
    private static final String TENANT_ID = SharePoint_Config__mdt.getInstance('Default').Tenant_Id__c;
    private static final String TOKEN_URL =
        'https://login.microsoftonline.com/' + TENANT_ID + '/oauth2/v2.0/token';

    public static String getAccessToken() {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:SharePointAuthNC/oauth2/v2.0/token');
        // Named Credential endpoint: https://login.microsoftonline.com/{tenant_id}
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody(
            'grant_type=client_credentials'
            + '&client_id=' + SharePoint_Config__mdt.getInstance('Default').Client_Id__c
            + '&client_secret=' + SharePoint_Config__mdt.getInstance('Default').Client_Secret__c
            + '&scope=https://graph.microsoft.com/.default'
        );
        HttpResponse res = new Http().send(req);
        Map<String,Object> body = (Map<String,Object>) JSON.deserializeUntyped(res.getBody());
        return (String) body.get('access_token');
    }
}
```

## Microsoft Graph API calls

Once you have the token, all SharePoint data goes through `https://graph.microsoft.com/v1.0/`:

```apex
public class SharePointApiService {
    // List all SharePoint sites
    public static List<Object> getSites() {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:GraphNC/v1.0/sites');
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + SharePointAuthService.getAccessToken());
        HttpResponse res = new Http().send(req);
        Map<String,Object> body = (Map<String,Object>) JSON.deserializeUntyped(res.getBody());
        return (List<Object>) body.get('value');
    }

    // List files in a drive (document library)
    public static List<Object> getFiles(String siteId, String driveId) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:GraphNC/v1.0/sites/' + siteId + '/drives/' + driveId + '/root/children');
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + SharePointAuthService.getAccessToken());
        HttpResponse res = new Http().send(req);
        Map<String,Object> body = (Map<String,Object>) JSON.deserializeUntyped(res.getBody());
        return (List<Object>) body.get('value');
    }

    // Upload a file to SharePoint
    public static void uploadFile(String siteId, String driveId, String fileName, Blob fileContent) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:GraphNC/v1.0/sites/' + siteId + '/drives/'
            + driveId + '/root:/' + fileName + ':/content');
        req.setMethod('PUT');
        req.setHeader('Authorization', 'Bearer ' + SharePointAuthService.getAccessToken());
        req.setHeader('Content-Type', 'application/octet-stream');
        req.setBodyAsBlob(fileContent);
        new Http().send(req);
    }
}
```

## Named Credential setup (two needed)

You need two Named Credentials for a clean separation:

| Named Credential | Endpoint | Purpose |
|-----------------|----------|---------|
| `SharePointAuthNC` | `https://login.microsoftonline.com/{tenant_id}` | Token endpoint — Azure AD |
| `GraphNC` | `https://graph.microsoft.com` | Microsoft Graph API calls |

Both use **No Authentication** protocol (you handle the Bearer token in code). Store Client ID, Client Secret, Tenant ID in Custom Metadata Types (`SharePoint_Config__mdt`).

## Client Credentials vs PKCE — when to use each

| | Client Credentials | PKCE (Auth Code) |
|--|--------------------|--------------------|
| User interaction required | No | Yes (one-time consent) |
| Permission scope | Application-level (all data in the org) | User-delegated (only what the user can access) |
| Use case | Org-wide integrations, scheduled jobs, batch | Per-user SharePoint access, document editing on behalf of a user |
| Token refresh | Re-request anytime — no refresh token needed | Refresh token required |

For org-wide SharePoint integrations (uploading documents, archiving records as files), Client Credentials is the right choice.

## Delegated vs Application permissions in Azure AD

- **Delegated permissions** — app acts on behalf of a user. Requires user login. User must have access to the resource.
- **Application permissions** — app acts as itself. No user required. Admin consent mandatory. Has access to all tenant data in the permitted scope.

SharePoint integrations from Salesforce scheduled jobs → use Application permissions (Client Credentials flow).
