---
title: Google Sheets Integration (JWT Bearer)
---

# Salesforce → Google Sheets Integration (JWT Bearer)

Full CRUD on a Google Sheet from Apex using a Google Service Account and JWT Bearer OAuth 2.0 — no user login required. The pattern applies to any Google API (Sheets, Drive, Gmail, Calendar).

---

## JWT Bearer flow overview

```
Apex builds JWT claim set  { iss, scope, aud, exp, iat }
  → signs with Service Account private key (RS256 via Crypto.sign)
  → POSTs to https://oauth2.googleapis.com/token
  → receives access_token (1 hour TTL)
  → uses access_token as Authorization: Bearer on Sheets API calls
```

---

## Setup — converting the key for Apex

The JSON key contains a PEM-format private key. `Crypto.sign()` needs DER-format bytes:

```bash
# Extract PEM from JSON
python3 -c "import json; print(json.load(open('key.json'))['private_key'])" > private.pem

# Convert PEM → PKCS8 DER → base64
openssl pkcs8 -topk8 -inform PEM -outform DER -nocrypt -in private.pem | base64 | tr -d '\n'
# Paste output into PRIVATE_KEY_B64 (or Protected Custom Setting)
```

---

## Apex — GoogleSheetsAuthService

```apex
public with sharing class GoogleSheetsAuthService {

    private static final String SERVICE_ACCOUNT_EMAIL =
        'your-service-account@your-project.iam.gserviceaccount.com';
    private static final String PRIVATE_KEY_B64 = 'YOUR_BASE64_ENCODED_PRIVATE_KEY';
    private static final String TOKEN_ENDPOINT  = 'callout:Google_OAuth/token';
    private static final String SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

    public class AuthException extends Exception {}

    public static String getAccessToken() {
        Long nowSecs = DateTime.now().getTime() / 1000;
        Long expSecs = nowSecs + 3600;

        // 1. JWT header (RS256)
        String header = base64url(Blob.valueOf('{"alg":"RS256","typ":"JWT"}'));

        // 2. JWT claims — Google-specific
        String claimsJson =
            '{"iss":"'  + SERVICE_ACCOUNT_EMAIL + '",' +
            '"scope":"' + SCOPE + '",' +
            '"aud":"https://oauth2.googleapis.com/token",' +
            '"exp":'    + expSecs + ',' +
            '"iat":'    + nowSecs + '}';
        String claims = base64url(Blob.valueOf(claimsJson));

        // 3. Sign with RS256 (Crypto.sign uses raw DER key bytes)
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

    // URL-safe Base64 (RFC 4648 §5) — required by JWT spec
    private static String base64url(Blob input) {
        return EncodingUtil.base64Encode(input)
            .replace('+', '-').replace('/', '_').replace('=', '');
    }
}
```

---

## Apex — GoogleSheetsService

```apex
public with sharing class GoogleSheetsService {

    private static final String BASE = 'callout:Google_Sheets/v4/spreadsheets/';

    public class SheetRange {
        @AuraEnabled public String             range;
        @AuraEnabled public List<List<String>> values;
    }

    public class WriteResult {
        @AuraEnabled public String updatedRange;
        @AuraEnabled public Integer updatedRows;
    }

    // ── READ ─────────────────────────────────────────────────────────────────
    @AuraEnabled
    public static SheetRange readRange(String spreadsheetId, String range) {
        String url = BASE + spreadsheetId + '/values/' + EncodingUtil.urlEncode(range, 'UTF-8');
        Map<String, Object> body = doGet(url);
        SheetRange result = new SheetRange();
        result.range  = (String) body.get('range');
        result.values = parseValues(body.get('values'));
        return result;
    }

    // ── APPEND ────────────────────────────────────────────────────────────────
    @AuraEnabled
    public static WriteResult appendRows(String spreadsheetId, String range, List<List<String>> rows) {
        String url = BASE + spreadsheetId + '/values/'
            + EncodingUtil.urlEncode(range, 'UTF-8')
            + ':append?valueInputOption=USER_ENTERED';
        return doWrite(url, 'POST', new Map<String, Object>{ 'values' => rows });
    }

    // ── UPDATE ────────────────────────────────────────────────────────────────
    @AuraEnabled
    public static WriteResult writeRange(String spreadsheetId, String range, List<List<String>> rows) {
        String url = BASE + spreadsheetId + '/values/'
            + EncodingUtil.urlEncode(range, 'UTF-8')
            + '?valueInputOption=USER_ENTERED';
        return doWrite(url, 'PUT', new Map<String, Object>{ 'majorDimension' => 'ROWS', 'values' => rows });
    }

    // ── CLEAR ─────────────────────────────────────────────────────────────────
    @AuraEnabled
    public static void clearRange(String spreadsheetId, String range) {
        String url = BASE + spreadsheetId + '/values/'
            + EncodingUtil.urlEncode(range, 'UTF-8') + ':clear';
        doWrite(url, 'POST', new Map<String, Object>());
    }

    // ── Helpers ───────────────────────────────────────────────────────────────
    private static Map<String, Object> doGet(String url) {
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

    private static WriteResult doWrite(String url, String method, Map<String, Object> payload) {
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
        WriteResult wr     = new WriteResult();
        wr.updatedRange    = (String)  body.get('updatedRange');
        wr.updatedRows     = (Integer) body.get('updatedRows');
        return wr;
    }

    @SuppressWarnings('PMD.AvoidDeeplyNestedIfStmts')
    private static List<List<String>> parseValues(Object rawValues) {
        List<List<String>> result = new List<List<String>>();
        if (rawValues == null) return result;
        for (Object rowObj : (List<Object>) rawValues) {
            List<String> row = new List<String>();
            for (Object cell : (List<Object>) rowObj) {
                row.add(cell != null ? String.valueOf(cell) : '');
            }
            result.add(row);
        }
        return result;
    }
}
```

---

## LWC — googleSheetViewer

A two-mode component: read mode shows the sheet as a table; write mode lets you append a new row. Demonstrates the key Apex CRUD operations from an LWC.

### HTML

```html
<template>
    <lightning-card title="Google Sheet Viewer" icon-name="standard:file">
        <div class="slds-p-around_medium">

            <!-- Config inputs -->
            <div class="slds-grid slds-gutters slds-m-bottom_medium">
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input
                        label="Spreadsheet ID"
                        placeholder="From the sheet URL"
                        value={spreadsheetId}
                        data-field="spreadsheetId"
                        onchange={handleConfigChange}>
                    </lightning-input>
                </div>
                <div class="slds-col slds-size_1-of-4">
                    <lightning-input
                        label="Range"
                        placeholder="Sheet1!A1:E20"
                        value={range}
                        data-field="range"
                        onchange={handleConfigChange}>
                    </lightning-input>
                </div>
                <div class="slds-col slds-size_1-of-4 slds-align-bottom">
                    <lightning-button
                        variant="brand"
                        label="Load Sheet"
                        onclick={handleLoad}
                        disabled={isLoading}>
                    </lightning-button>
                </div>
            </div>

            <!-- Error banner -->
            <template lwc:if={error}>
                <div class="slds-notify slds-notify_alert slds-alert_error slds-m-bottom_small" role="alert">
                    <lightning-icon icon-name="utility:error" size="x-small"
                                    class="slds-m-right_x-small"></lightning-icon>
                    {error}
                </div>
            </template>

            <!-- Loading -->
            <template lwc:if={isLoading}>
                <div class="slds-align_absolute-center slds-p-around_large">
                    <lightning-spinner alternative-text="Loading sheet" size="small"></lightning-spinner>
                </div>
            </template>

            <!-- Sheet data table -->
            <template lwc:if={hasRows}>
                <p class="slds-text-body_small slds-text-color_weak slds-m-bottom_x-small">
                    Showing {rows.length} rows from {loadedRange}
                </p>
                <div class="slds-scrollable_x">
                    <table class="slds-table slds-table_cell-buffer slds-table_bordered slds-table_striped">
                        <thead>
                            <tr class="slds-line-height_reset">
                                <template for:each={headers} for:item="h">
                                    <th key={h} scope="col">
                                        <div class="slds-truncate">{h}</div>
                                    </th>
                                </template>
                            </tr>
                        </thead>
                        <tbody>
                            <template for:each={dataRows} for:item="row">
                                <tr key={row.key}>
                                    <template for:each={row.cells} for:item="cell">
                                        <td key={cell.key}>
                                            <div class="slds-truncate">{cell.value}</div>
                                        </td>
                                    </template>
                                </tr>
                            </template>
                        </tbody>
                    </table>
                </div>

                <!-- Append new row form -->
                <div class="slds-m-top_medium slds-box slds-theme_shade">
                    <h3 class="slds-text-heading_small slds-m-bottom_small">Append a Row</h3>
                    <lightning-input
                        label="Values (comma-separated)"
                        placeholder="Abhilash, Lead Dev, Bangalore"
                        value={appendInput}
                        data-field="appendInput"
                        onchange={handleConfigChange}>
                    </lightning-input>
                    <div class="slds-m-top_small">
                        <lightning-button
                            variant="neutral"
                            label="Append Row"
                            onclick={handleAppend}
                            disabled={isAppending}>
                        </lightning-button>
                        <template lwc:if={appendMessage}>
                            <span class="slds-m-left_small slds-text-color_success">{appendMessage}</span>
                        </template>
                    </div>
                </div>
            </template>

            <!-- Empty state -->
            <template lwc:if={showEmpty}>
                <p class="slds-text-color_weak slds-text-align_center slds-p-around_large">
                    Enter a Spreadsheet ID and range, then click Load Sheet.
                </p>
            </template>

        </div>
    </lightning-card>
</template>
```

### JavaScript

```javascript
import { LightningElement } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import readRange   from '@salesforce/apex/GoogleSheetsService.readRange';
import appendRows  from '@salesforce/apex/GoogleSheetsService.appendRows';

export default class GoogleSheetViewer extends LightningElement {

    spreadsheetId = '';
    range         = 'Sheet1!A1:E20';
    appendInput   = '';
    appendMessage = '';

    isLoading   = false;
    isAppending = false;
    error       = null;

    _rows      = [];
    loadedRange = '';

    get rows()       { return this._rows; }
    get hasRows()    { return this._rows.length > 0; }
    get showEmpty()  { return !this.isLoading && !this.hasRows; }

    // First row is headers, remaining rows are data
    get headers()  { return this._rows.length > 0 ? this._rows[0] : []; }
    get dataRows() {
        return this._rows.slice(1).map((row, ri) => ({
            key: `row-${ri}`,
            cells: row.map((cell, ci) => ({ key: `cell-${ri}-${ci}`, value: cell || '' }))
        }));
    }

    handleConfigChange(event) {
        this[event.target.dataset.field] = event.target.value;
    }

    // ── Load sheet ────────────────────────────────────────────────────────────

    async handleLoad() {
        if (!this.spreadsheetId.trim()) {
            this._toast('Missing', 'Enter a Spreadsheet ID', 'warning');
            return;
        }
        this.isLoading = true;
        this.error     = null;
        try {
            // LWC → Apex → Google Sheets API (JWT Bearer) → back to LWC
            const result = await readRange({
                spreadsheetId: this.spreadsheetId,
                range:         this.range
            });
            this._rows      = result.values || [];
            this.loadedRange = result.range || this.range;
        } catch (err) {
            this.error = err?.body?.message || err?.message || 'Load failed';
        } finally {
            this.isLoading = false;
        }
    }

    // ── Append row ────────────────────────────────────────────────────────────

    async handleAppend() {
        if (!this.appendInput.trim()) return;
        this.isAppending   = true;
        this.appendMessage = '';
        try {
            // Parse comma-separated input into a row array
            const cellValues = this.appendInput.split(',').map(s => s.trim());
            // rows param is List<List<String>> in Apex — wrap in outer array
            const result = await appendRows({
                spreadsheetId: this.spreadsheetId,
                range:         this.range,
                rows:          [cellValues]   // one row
            });
            this.appendMessage = `Appended to ${result.updatedRange}`;
            this.appendInput   = '';
            // Reload to show the new row
            await this.handleLoad();
            this._toast('Appended', 'Row added to sheet.', 'success');
        } catch (err) {
            this._toast('Error', err?.body?.message || err?.message || 'Append failed', 'error');
        } finally {
            this.isAppending = false;
        }
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}
```

---

## Named Credentials setup

| Name | URL |
|------|-----|
| `Google_OAuth` | `https://oauth2.googleapis.com` |
| `Google_Sheets` | `https://sheets.googleapis.com` |

Both use **No Authentication** — auth handled in Apex via Bearer token.

---

## Sheets API reference

| Operation | Method | Path suffix |
|-----------|--------|-------------|
| Read | GET | `/values/{range}` |
| Append | POST | `/values/{range}:append?valueInputOption=USER_ENTERED` |
| Update | PUT | `/values/{range}?valueInputOption=USER_ENTERED` |
| Clear | POST | `/values/{range}:clear` |

---

## LWC patterns demonstrated

| Pattern | Where |
|---------|-------|
| **Imperative Apex (not `@wire`)** | `await readRange({...})` — used because load is triggered by button, not auto on mount |
| **Computed row/header getters** | `headers` = first row; `dataRows` = remaining rows with key injection for `for:each` |
| **`for:each` with generated keys** | `row.key` and `cell.key` — every item in a list needs a unique `key` in LWC |
| **Generic `data-field` handler** | `handleConfigChange` updates `this[event.target.dataset.field]` — one handler for all inputs |
| **Reload after mutation** | `handleAppend` appends, then calls `this.handleLoad()` to refresh the table |
| **`async/await` in series** | `await appendRows(...)` → `await this.handleLoad()` — second call only starts after first finishes |
| **`slds-scrollable_x`** | Horizontal scroll for wide tables — wrap the `<table>` in a div with this class |

---

## `Crypto.sign` vs `Crypto.signWithCertificate`

| | `Crypto.sign()` | `Crypto.signWithCertificate()` |
|--|---|---|
| **Key source** | Raw DER bytes from base64 string | Certificate in Salesforce Cert & Key Management |
| **Used for** | Google APIs (key stored as constant/Custom Setting) | Salesforce-to-Salesforce JWT Bearer |
| **Setup** | Store base64 key in Protected Custom Setting | Upload `.p12` keystore in Setup |
