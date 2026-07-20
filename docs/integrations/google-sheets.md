---
title: Google Sheets Integration (JWT Bearer)
---

# Salesforce → Google Sheets Integration (JWT Bearer)

Full CRUD on a Google Sheet from Apex using a Google Service Account and JWT Bearer OAuth 2.0 — no user login required. The pattern applies to any Google API (Sheets, Drive, Gmail, Calendar, etc.).

## JWT Bearer flow overview

```
Apex builds a JWT claim set
  → signs it with the Service Account private key (RS256)
  → POSTs JWT to https://oauth2.googleapis.com/token
  → receives access_token (1 hour TTL)
  → uses access_token as Bearer on all Sheets API calls
```

This is a **machine-to-machine** flow. The Service Account's email address acts as the identity — it authenticates as itself, not as any human user.

## Setup — Google Cloud side

1. Create a Google Cloud Project → enable **Google Sheets API** (APIs & Services → Library)
2. Create a Service Account (IAM & Admin → Service Accounts → Create) — give it **Editor** role
3. Create a JSON key for the service account (Keys tab → Add Key → JSON) — download it
4. Share your Google Sheet with the service account's `client_email` address and give it **Editor** access

## Setup — converting the key for Apex

The JSON key contains a PEM-format private key. Apex's `Crypto.sign()` expects DER-format bytes. Convert and base64-encode for storage in Apex (or a Protected Custom Setting):

```bash
# Extract private key from the JSON
python3 -c "import json; print(json.load(open('key.json'))['private_key'])" > private.pem

# Convert to PKCS8 DER and base64-encode
openssl pkcs8 -topk8 -inform PEM -outform DER -nocrypt -in private.pem | base64 | tr -d '\n'
# Copy output → paste into PRIVATE_KEY_B64 constant (or Protected Custom Setting)
```

## Auth — GoogleSheetsAuthService

```apex
public with sharing class GoogleSheetsAuthService {

    // Values from the Service Account JSON key file
    private static final String SERVICE_ACCOUNT_EMAIL =
        'your-service-account@your-project.iam.gserviceaccount.com';

    // base64 of: openssl pkcs8 -topk8 -inform PEM -outform DER -nocrypt -in private.pem
    // Store in Protected Hierarchy Custom Setting in production
    private static final String PRIVATE_KEY_B64 = 'YOUR_BASE64_ENCODED_PRIVATE_KEY';

    private static final String TOKEN_ENDPOINT = 'callout:Google_OAuth/token';
    private static final String SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

    public static String getAccessToken() {
        Long nowSecs = DateTime.now().getTime() / 1000;
        Long expSecs = nowSecs + 3600; // Google max: 1 hour

        // 1. JWT header (RS256)
        String header = base64url(Blob.valueOf('{"alg":"RS256","typ":"JWT"}'));

        // 2. JWT claims — Google-specific fields
        String claimsJson =
            '{"iss":"'  + SERVICE_ACCOUNT_EMAIL + '",' +
            '"scope":"' + SCOPE + '",' +
            '"aud":"https://oauth2.googleapis.com/token",' +
            '"exp":'    + expSecs + ',' +
            '"iat":'    + nowSecs + '}';
        String claims = base64url(Blob.valueOf(claimsJson));

        // 3. Sign with RS256
        String signingInput = header + '.' + claims;
        Blob privateKey     = EncodingUtil.base64Decode(PRIVATE_KEY_B64);
        Blob signature      = Crypto.sign('RSA-SHA256', Blob.valueOf(signingInput), privateKey);
        String jwt          = signingInput + '.' + base64url(signature);

        // 4. Exchange JWT for access token
        HttpRequest req = new HttpRequest();
        req.setEndpoint(TOKEN_ENDPOINT);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody(
            'grant_type=' +
            EncodingUtil.urlEncode('urn:ietf:params:oauth:grant-type:jwt-bearer', 'UTF-8') +
            '&assertion=' + EncodingUtil.urlEncode(jwt, 'UTF-8')
        );

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new AuthException('Google JWT auth failed [' + res.getStatusCode() + ']: ' + res.getBody());
        }

        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        return (String) body.get('access_token');
    }

    // URL-safe Base64 (RFC 4648 §5) — JWT requires + → -, / → _, strip =
    private static String base64url(Blob input) {
        return EncodingUtil.base64Encode(input)
            .replace('+', '-').replace('/', '_').replace('=', '');
    }

    public class AuthException extends Exception {}
}
```

## CRUD — GoogleSheetsService

```apex
public with sharing class GoogleSheetsService {

    private static final String BASE = 'callout:Google_Sheets/v4/spreadsheets/';

    // ── READ ─────────────────────────────────────────────────────────────────
    @AuraEnabled
    public static SheetRange readRange(String spreadsheetId, String range) {
        String url = BASE + spreadsheetId + '/values/' + EncodingUtil.urlEncode(range, 'UTF-8');
        Map<String, Object> body = callGet(url);
        // body contains: range, majorDimension, values (List<List<String>>)
        SheetRange result = new SheetRange();
        result.range  = (String) body.get('range');
        result.values = parseValues(body.get('values'));
        return result;
    }

    // ── APPEND (add rows to end of existing data) ─────────────────────────
    @AuraEnabled
    public static WriteResult appendRows(String spreadsheetId, String range, List<List<String>> rows) {
        String url = BASE + spreadsheetId + '/values/' +
                     EncodingUtil.urlEncode(range, 'UTF-8') +
                     ':append?valueInputOption=USER_ENTERED';
        Map<String, Object> payload = new Map<String, Object>{
            'values' => rows
        };
        return callWrite(url, 'POST', payload);
    }

    // ── UPDATE (overwrite specific range) ─────────────────────────────────
    @AuraEnabled
    public static WriteResult writeRange(String spreadsheetId, String range, List<List<String>> rows) {
        String url = BASE + spreadsheetId + '/values/' +
                     EncodingUtil.urlEncode(range, 'UTF-8') +
                     '?valueInputOption=USER_ENTERED';
        Map<String, Object> payload = new Map<String, Object>{
            'majorDimension' => 'ROWS',
            'values'         => rows
        };
        return callWrite(url, 'PUT', payload);
    }

    // ── DELETE (clear a range) ────────────────────────────────────────────
    @AuraEnabled
    public static void clearRange(String spreadsheetId, String range) {
        String url = BASE + spreadsheetId + '/values/' +
                     EncodingUtil.urlEncode(range, 'UTF-8') + ':clear';
        callWrite(url, 'POST', new Map<String, Object>());
    }

    // ── helpers ──────────────────────────────────────────────────────────────

    private static Map<String, Object> callGet(String url) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(url);
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + GoogleSheetsAuthService.getAccessToken());
        req.setTimeout(30000);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new AuraHandledException('Sheets GET failed: ' + res.getBody());
        }
        return (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
    }

    private static WriteResult callWrite(String url, String method, Map<String, Object> payload) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(url);
        req.setMethod(method);
        req.setHeader('Authorization', 'Bearer ' + GoogleSheetsAuthService.getAccessToken());
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(payload));
        req.setTimeout(30000);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() < 200 || res.getStatusCode() >= 300) {
            throw new AuraHandledException('Sheets write failed: ' + res.getBody());
        }
        Map<String, Object> body = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        WriteResult wr = new WriteResult();
        wr.updatedRange = (String) body.get('updatedRange');
        return wr;
    }

    public class SheetRange {
        @AuraEnabled public String            range;
        @AuraEnabled public List<List<String>> values;
    }

    public class WriteResult {
        @AuraEnabled public String updatedRange;
    }
}
```

## Named Credentials setup

Two Named Credentials — one for the token endpoint, one for the API:

| Name | URL |
|------|-----|
| `Google_OAuth` | `https://oauth2.googleapis.com` |
| `Google_Sheets` | `https://sheets.googleapis.com` |

Both use **No Authentication** — auth is handled in Apex via Bearer token.

## Sheets API reference

| Operation | Method | Endpoint |
|-----------|--------|----------|
| Read | GET | `/v4/spreadsheets/{id}/values/{range}` |
| Append | POST | `/v4/spreadsheets/{id}/values/{range}:append?valueInputOption=USER_ENTERED` |
| Update | PUT | `/v4/spreadsheets/{id}/values/{range}?valueInputOption=USER_ENTERED` |
| Clear | POST | `/v4/spreadsheets/{id}/values/{range}:clear` |
| Metadata | GET | `/v4/spreadsheets/{id}?fields=properties` |

**valueInputOption values:**
- `RAW` — stored exactly as entered, no formula evaluation
- `USER_ENTERED` — parsed as if typed by a user (formulas work, dates formatted)

## Test from Execute Anonymous

```apex
String sheetId = 'YOUR_SPREADSHEET_ID'; // from URL: /spreadsheets/d/{ID}/edit

// READ
GoogleSheetsService.SheetRange data = GoogleSheetsService.readRange(sheetId, 'Sheet1!A1:E10');
for (List<String> row : data.values) {
    System.debug(String.join(row, ' | '));
}

// APPEND
List<List<String>> rows = new List<List<String>>{
    new List<String>{ 'Abhilash', 'Lead Engineer', 'Bangalore' }
};
GoogleSheetsService.WriteResult appended = GoogleSheetsService.appendRows(sheetId, 'Sheet1!A:Z', rows);
System.debug('Appended to: ' + appended.updatedRange);

// UPDATE row 2
List<List<String>> updated = new List<List<String>>{
    new List<String>{ 'Abhilash D', 'Senior Dev', 'Bangalore' }
};
GoogleSheetsService.writeRange(sheetId, 'Sheet1!A2:C2', updated);

// CLEAR from row 3 onwards
GoogleSheetsService.clearRange(sheetId, 'Sheet1!A3:Z100');
```

## JWT Bearer vs Client Credentials

| | JWT Bearer (Google Sheets) | Client Credentials (Spotify, Salesforce) |
|--|---|---|
| **Identity assertion** | Signed JWT (`iss` = service account email) | Client ID + Secret |
| **Signing required?** | Yes — RS256, needs private key + cert | No |
| **Setup effort** | Higher — GCP project, service account, key conversion | Lower — just app credentials |
| **Token endpoint grant** | `urn:ietf:params:oauth:grant-type:jwt-bearer` | `client_credentials` |
| **Best for** | Google APIs, Salesforce-to-Salesforce | Most external SaaS APIs |

## Crypto.sign vs Crypto.signWithCertificate

| | `Crypto.sign()` | `Crypto.signWithCertificate()` |
|--|---|---|
| **Key source** | Raw DER bytes (decoded from base64 string) | Certificate stored in Salesforce Cert & Key Management |
| **Used here for** | Google (private key loaded from constant/Custom Setting) | Salesforce-to-Salesforce JWT Bearer |
| **Setup** | Store key as base64 string in Protected Custom Setting | Upload `.p12` keystore in Setup → Cert & Key Mgmt |
