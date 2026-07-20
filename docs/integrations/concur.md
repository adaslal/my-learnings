---
title: SAP Concur Integration
---

# Salesforce ↔ SAP Concur Integration

Syncs Expense Reports and Travel/Reimbursement Requests from SAP Concur into Salesforce custom objects, surfaced via an LWC dashboard with on-demand sync and optional scheduled nightly automation.

## Architecture

```
SAP Concur                             Salesforce
──────────────────────────────────     ────────────────────────────────────
/oauth2/v0/token  ←──  ConcurAuthService (refresh token grant)
/api/v3.0/expense/reports  ←──  ConcurExpenseService.syncFromConcur()
/travelrequest/v4/requests  ←──
                                  │ upserts on External ID
                             Concur_Expense_Report__c
                             Concur_Travel_Request__c
                                  │
                        concurExpenseDashboard (LWC)
                        ┌──────────────────────────────┐
                        │ Expense Reports  │  Reimb     │
                        │  (tab 1)         │ (tab 2)    │
                        └──────────────────────────────┘
```

## Why Concur isn't standard Client Credentials

Concur's company-level auth is a two-step process — it can't use a pure Client Credentials flow:

**Step 1 (one-time manual):** Generate a Company Request Token in Concur's OAuth 2.0 App Management Tool, then exchange it for a persistent `refresh_token`:

```bash
curl -X POST https://us.api.concursolutions.com/oauth2/v0/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "client_id=YOUR_CLIENT_ID" \
  -d "client_secret=YOUR_CLIENT_SECRET" \
  -d "grant_type=password" \
  -d "username=YOUR_COMPANY_UUID" \
  -d "password=YOUR_REQUEST_TOKEN" \
  -d "credtype=authtoken"
```

**Step 2 (automated, every API call):** Use the stored `refresh_token` to get a short-lived `access_token`. This is what `ConcurAuthService` does on every transaction.

```
stored refresh_token → POST /oauth2/v0/token → access_token (1 hour TTL)
access_token → Authorization: Bearer header on every API call
```

The `refresh_token` is long-lived and company-scoped — it's the master credential. Store it in a **Protected Custom Setting** or **External Credential parameter**, not hardcoded in Apex.

---

## Apex — ConcurAuthService

```apex
public with sharing class ConcurAuthService {

    private static final String TOKEN_ENDPOINT  = 'callout:Concur_API/oauth2/v0/token';
    private static final String CLIENT_ID       = 'YOUR_CONCUR_CLIENT_ID';
    private static final String CLIENT_SECRET   = 'YOUR_CONCUR_CLIENT_SECRET';
    private static final String REFRESH_TOKEN   = 'YOUR_COMPANY_REFRESH_TOKEN'; // store in Protected Custom Setting

    public class AuthException extends Exception {}

    public static String getAccessToken() {
        String requestBody = 'grant_type=refresh_token'
            + '&refresh_token=' + EncodingUtil.urlEncode(REFRESH_TOKEN, 'UTF-8')
            + '&client_id='     + EncodingUtil.urlEncode(CLIENT_ID, 'UTF-8')
            + '&client_secret=' + EncodingUtil.urlEncode(CLIENT_SECRET, 'UTF-8');

        HttpRequest req = new HttpRequest();
        req.setEndpoint(TOKEN_ENDPOINT);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/x-www-form-urlencoded');
        req.setBody(requestBody);
        req.setTimeout(20000);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new AuthException(
                'Concur token refresh failed (' + res.getStatusCode() + '): ' + res.getBody());
        }

        Map<String, Object> parsed = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        String accessToken = (String) parsed.get('access_token');
        if (String.isBlank(accessToken)) {
            throw new AuthException('Token response did not contain access_token: ' + res.getBody());
        }
        return accessToken;
    }
}
```

---

## Apex — ConcurExpenseService

Key design: implements `Schedulable` so the same class handles both the LWC sync button and nightly scheduled jobs. Idempotent upsert on External IDs — re-running doesn't create duplicate records.

```apex
public with sharing class ConcurExpenseService implements Schedulable {

    private static final String BASE_URL             = 'callout:Concur_API';
    private static final String EXPENSE_REPORTS_PATH = '/api/v3.0/expense/reports';
    private static final String TRAVEL_REQUESTS_PATH = '/travelrequest/v4/requests';

    // ── Schedulable (nightly cron) ────────────────────────────────────────────
    public void execute(SchedulableContext ctx) {
        syncFromConcur();
    }

    // ── Called by LWC "Sync" button ───────────────────────────────────────────
    @AuraEnabled
    public static void syncFromConcur() {
        String accessToken = ConcurAuthService.getAccessToken();
        fetchAndUpsertExpenseReports(accessToken);
        fetchAndUpsertTravelRequests(accessToken);
    }

    // ── Called by @wire in LWC (cacheable) ────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Concur_Expense_Report__c> getExpenseReports() {
        return [
            SELECT Id, Name, Concur_Report_Id__c, Total__c, Currency_Code__c,
                   Submit_Date__c, Approval_Status__c, Payment_Status__c,
                   Amount_Due_Employee__c, Employee_Name__c, Employee_Email__c
            FROM Concur_Expense_Report__c
            ORDER BY Submit_Date__c DESC NULLS LAST
            LIMIT 200
        ];
    }

    @AuraEnabled(cacheable=true)
    public static List<Concur_Travel_Request__c> getTravelRequests() {
        return [
            SELECT Id, Name, Concur_Request_Id__c, Status__c,
                   Total_Approved_Amount__c, Currency__c,
                   Start_Date__c, End_Date__c, Requester_Name__c,
                   Purpose__c, Submit_Date__c, Destination__c
            FROM Concur_Travel_Request__c
            ORDER BY Submit_Date__c DESC NULLS LAST
            LIMIT 200
        ];
    }

    private static void fetchAndUpsertExpenseReports(String token) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint(BASE_URL + EXPENSE_REPORTS_PATH + '?user=ALL&limit=100');
        req.setMethod('GET');
        req.setHeader('Authorization', 'Bearer ' + token);
        req.setTimeout(30000);
        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) { return; }

        Map<String, Object> body  = (Map<String, Object>) JSON.deserializeUntyped(res.getBody());
        List<Object> items = (List<Object>) body.get('Items');
        if (items == null || items.isEmpty()) { return; }

        List<Concur_Expense_Report__c> toUpsert = new List<Concur_Expense_Report__c>();
        for (Object itemObj : items) {
            Map<String, Object> item = (Map<String, Object>) itemObj;
            toUpsert.add(new Concur_Expense_Report__c(
                Concur_Report_Id__c    = (String)  item.get('ID'),
                Name                   = (String)  item.get('Name'),
                Total__c               = item.get('Total') != null
                                         ? Decimal.valueOf(String.valueOf(item.get('Total'))) : null,
                Currency_Code__c       = (String)  item.get('CurrencyCode'),
                Approval_Status__c     = (String)  item.get('ApprovalStatusName'),
                Payment_Status__c      = (String)  item.get('PaymentStatusName'),
                Employee_Name__c       = (String)  item.get('EmployeeName')
            ));
        }
        // Idempotent upsert — re-running doesn't create duplicates
        upsert toUpsert Concur_Report_Id__c;
    }

    private static void fetchAndUpsertTravelRequests(String token) {
        // Same pattern — GET travel requests, parse, upsert on Concur_Request_Id__c
    }
}
```

## Scheduling the nightly sync

```apex
// Run once from Execute Anonymous to register:
String cron = '0 0 2 * * ?'; // 2 AM daily
System.schedule('Concur Nightly Sync', cron, new ConcurExpenseService());
```

---

## LWC — concurExpenseDashboard

### HTML

```html
<template>
    <lightning-card title="Concur Expense &amp; Reimbursement Dashboard"
                    icon-name="standard:expense">

        <!-- Sync button in card header -->
        <div slot="actions">
            <lightning-button
                variant="brand"
                label="Sync from Concur"
                icon-name="utility:refresh"
                onclick={handleSync}
                disabled={isSyncing}>
            </lightning-button>
        </div>

        <div class="slds-p-around_medium">

            <!-- Loading spinner during sync -->
            <template lwc:if={isSyncing}>
                <div class="slds-align_absolute-center slds-m-bottom_medium">
                    <lightning-spinner alternative-text="Syncing" size="small"></lightning-spinner>
                    <span class="slds-m-left_small slds-text-color_weak">Syncing from Concur...</span>
                </div>
            </template>

            <!-- Error banner -->
            <template lwc:if={syncError}>
                <div class="slds-notify slds-notify_alert slds-alert_error slds-m-bottom_medium" role="alert">
                    <lightning-icon icon-name="utility:error" size="x-small"
                                    class="slds-m-right_x-small"></lightning-icon>
                    {syncError}
                </div>
            </template>

            <!-- Two-tab layout -->
            <lightning-tabset active-tab-value={activeTab}>

                <!-- Tab 1: Expense Reports -->
                <lightning-tab label="Expense Reports" value="expense" onactive={handleTabActive}>
                    <template lwc:if={hasExpenseReports}>
                        <table class="slds-table slds-table_cell-buffer slds-table_bordered slds-table_striped">
                            <thead>
                                <tr class="slds-line-height_reset">
                                    <th scope="col"><div class="slds-truncate">Report Name</div></th>
                                    <th scope="col"><div class="slds-truncate">Employee</div></th>
                                    <th scope="col"><div class="slds-truncate">Total</div></th>
                                    <th scope="col"><div class="slds-truncate">Due to Employee</div></th>
                                    <th scope="col"><div class="slds-truncate">Approval</div></th>
                                    <th scope="col"><div class="slds-truncate">Payment</div></th>
                                    <th scope="col"><div class="slds-truncate">Submitted</div></th>
                                </tr>
                            </thead>
                            <tbody>
                                <template for:each={expenseReports} for:item="r">
                                    <tr key={r.Id}>
                                        <td><div class="slds-truncate">{r.Name}</div></td>
                                        <td><div class="slds-truncate">{r.Employee_Name__c}</div></td>
                                        <td><div class="slds-truncate">{r.Currency_Code__c} {r.TotalFormatted}</div></td>
                                        <td><div class="slds-truncate">{r.Currency_Code__c} {r.AmountDueFormatted}</div></td>
                                        <td>
                                            <lightning-badge label={r.Approval_Status__c}
                                                            class={r.approvalBadgeClass}></lightning-badge>
                                        </td>
                                        <td><div class="slds-truncate">{r.Payment_Status__c}</div></td>
                                        <td><div class="slds-truncate">{r.SubmitDateFormatted}</div></td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </template>
                    <template lwc:elseif={isLoadingExpense}>
                        <div class="slds-align_absolute-center slds-p-around_large">
                            <lightning-spinner alternative-text="Loading" size="small"></lightning-spinner>
                        </div>
                    </template>
                    <template lwc:else>
                        <p class="slds-text-color_weak slds-p-around_medium">
                            No expense reports. Click "Sync from Concur" to fetch data.
                        </p>
                    </template>
                </lightning-tab>

                <!-- Tab 2: Travel / Reimbursement Requests -->
                <lightning-tab label="Reimbursement Requests" value="travel" onactive={handleTabActive}>
                    <template lwc:if={hasTravelRequests}>
                        <table class="slds-table slds-table_cell-buffer slds-table_bordered slds-table_striped">
                            <thead>
                                <tr class="slds-line-height_reset">
                                    <th scope="col"><div class="slds-truncate">Request Name</div></th>
                                    <th scope="col"><div class="slds-truncate">Requester</div></th>
                                    <th scope="col"><div class="slds-truncate">Destination</div></th>
                                    <th scope="col"><div class="slds-truncate">Approved Amount</div></th>
                                    <th scope="col"><div class="slds-truncate">Status</div></th>
                                    <th scope="col"><div class="slds-truncate">Travel Dates</div></th>
                                </tr>
                            </thead>
                            <tbody>
                                <template for:each={travelRequests} for:item="t">
                                    <tr key={t.Id}>
                                        <td><div class="slds-truncate">{t.Name}</div></td>
                                        <td><div class="slds-truncate">{t.Requester_Name__c}</div></td>
                                        <td><div class="slds-truncate">{t.Destination__c}</div></td>
                                        <td><div class="slds-truncate">{t.Currency__c} {t.AmountFormatted}</div></td>
                                        <td>
                                            <lightning-badge label={t.Status__c}
                                                            class={t.statusBadgeClass}></lightning-badge>
                                        </td>
                                        <td><div class="slds-truncate">{t.TravelDates}</div></td>
                                    </tr>
                                </template>
                            </tbody>
                        </table>
                    </template>
                    <template lwc:else>
                        <p class="slds-text-color_weak slds-p-around_medium">
                            No reimbursement requests. Click "Sync from Concur" to fetch data.
                        </p>
                    </template>
                </lightning-tab>

            </lightning-tabset>
        </div>
    </lightning-card>
</template>
```

### JavaScript

```javascript
import { LightningElement, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getExpenseReports from '@salesforce/apex/ConcurExpenseService.getExpenseReports';
import getTravelRequests from '@salesforce/apex/ConcurExpenseService.getTravelRequests';
import syncFromConcur    from '@salesforce/apex/ConcurExpenseService.syncFromConcur';

export default class ConcurExpenseDashboard extends LightningElement {

    activeTab        = 'expense';
    isSyncing        = false;
    syncError        = null;
    isLoadingExpense = true;
    isLoadingTravel  = true;

    _rawExpenseReports = [];
    _rawTravelRequests = [];
    _wiredExpenseResult;
    _wiredTravelResult;

    // ── @wire — loads stored data on mount ───────────────────────────────────

    @wire(getExpenseReports)
    wiredExpenseReports(result) {
        this._wiredExpenseResult = result;   // store ref for refreshApex
        this.isLoadingExpense = false;
        if (result.data) {
            // Enrich records with computed display fields
            this._rawExpenseReports = result.data.map(r => this._enrichExpenseReport(r));
        } else if (result.error) {
            this._showToast('Error loading expense reports', this._extractError(result.error), 'error');
        }
    }

    @wire(getTravelRequests)
    wiredTravelRequests(result) {
        this._wiredTravelResult = result;
        this.isLoadingTravel = false;
        if (result.data) {
            this._rawTravelRequests = result.data.map(t => this._enrichTravelRequest(t));
        } else if (result.error) {
            this._showToast('Error loading travel requests', this._extractError(result.error), 'error');
        }
    }

    // ── Getters ──────────────────────────────────────────────────────────────

    get expenseReports()    { return this._rawExpenseReports; }
    get travelRequests()    { return this._rawTravelRequests; }
    get hasExpenseReports() { return this._rawExpenseReports.length > 0; }
    get hasTravelRequests() { return this._rawTravelRequests.length > 0; }

    // ── Event handlers ────────────────────────────────────────────────────────

    handleTabActive(event) {
        this.activeTab = event.target.value;
    }

    async handleSync() {
        this.isSyncing = true;
        this.syncError = null;
        try {
            await syncFromConcur();
            // refreshApex busts the @wire cache so tables reload with fresh data
            await refreshApex(this._wiredExpenseResult);
            await refreshApex(this._wiredTravelResult);
            this._showToast('Sync complete', 'Updated from Concur.', 'success');
        } catch (err) {
            this.syncError = this._extractError(err);
            this._showToast('Sync failed', this.syncError, 'error');
        } finally {
            this.isSyncing = false;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _enrichExpenseReport(r) {
        return Object.assign({}, r, {
            TotalFormatted:     this._fmt(r.Total__c),
            AmountDueFormatted: this._fmt(r.Amount_Due_Employee__c),
            SubmitDateFormatted: this._fmtDate(r.Submit_Date__c),
            approvalBadgeClass: this._approvalBadge(r.Approval_Status__c)
        });
    }

    _enrichTravelRequest(t) {
        const start = t.Start_Date__c ? new Date(t.Start_Date__c).toLocaleDateString() : '';
        const end   = t.End_Date__c   ? new Date(t.End_Date__c).toLocaleDateString()   : '';
        return Object.assign({}, t, {
            AmountFormatted:     this._fmt(t.Total_Approved_Amount__c),
            SubmitDateFormatted: this._fmtDate(t.Submit_Date__c),
            TravelDates:         start && end ? `${start} – ${end}` : (start || end || '—'),
            statusBadgeClass:    this._statusBadge(t.Status__c)
        });
    }

    _fmt(val) {
        if (val == null) return '—';
        return Number(val).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    _fmtDate(iso) {
        return iso ? new Date(iso).toLocaleDateString() : '—';
    }

    _approvalBadge(status = '') {
        const s = status.toLowerCase();
        if (s.includes('approved')) return 'slds-theme_success';
        if (s.includes('pending'))  return 'slds-theme_warning';
        if (s.includes('reject') || s.includes('denied')) return 'slds-theme_error';
        return '';
    }

    _statusBadge(status = '') {
        const s = status.toLowerCase();
        if (s.includes('approved'))  return 'slds-theme_success';
        if (s.includes('submitted') || s.includes('pending')) return 'slds-theme_warning';
        if (s.includes('cancel') || s.includes('reject'))     return 'slds-theme_error';
        return '';
    }

    _showToast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    _extractError(err) {
        return (err?.body?.message) || (err?.message) || 'Unknown error';
    }
}
```

---

## Named Credential setup

| Field | Value |
|-------|-------|
| Label / Name | `Concur_API` |
| URL | `https://us.api.concursolutions.com` |
| Authentication Protocol | No Authentication *(auth handled in Apex via Bearer token)* |
| Generate Authorization Header | Unchecked |

---

## LWC patterns demonstrated in this component

| Pattern | Where |
|---------|-------|
| **`@wire` with stored result ref** | `this._wiredExpenseResult = result` — required to call `refreshApex` later |
| **`refreshApex` after mutation** | Sync button → calls imperative Apex → calls `refreshApex(wireRef)` to bust the `cacheable=true` cache |
| **Imperative + `@wire` in same component** | `getExpenseReports` is wired (auto-loads on mount); `syncFromConcur` is imperative (called by button) |
| **Computed display fields** | `_enrichExpenseReport()` transforms raw Salesforce field values into display-ready strings using `Object.assign({}, r, {...})` — original record not mutated |
| **`lightning-badge` with dynamic CSS** | `approvalBadgeClass` getter returns SLDS theme class based on status string |
| **`lightning-tabset` with `onactive`** | Tracks active tab so you can conditionally load data per tab |
| **`lwc:if` / `lwc:elseif` / `lwc:else`** | Three-state table: data → loading → empty |
| **Spinner + button `disabled` during async** | `isSyncing` flag disables the Sync button and shows spinner while `await syncFromConcur()` is running |
| **`async/await` with `try/finally`** | `finally` ensures `isSyncing = false` even if the callout throws |

---

## Patterns demonstrated (Apex + LWC together)

| Pattern | How it appears here |
|---------|-------------------|
| **Refresh token grant** | `grant_type=refresh_token` — differs from Client Credentials (no user but not purely machine-credential) |
| **Schedulable + service class** | Same class handles `execute(ctx)` and `@AuraEnabled` — single responsibility, two entry points |
| **Idempotent upsert** | External ID on `Concur_Report_Id__c` — sync is re-runnable, no duplicates |
| **Multi-version APIs** | v3.0 and v4 on same host — single Named Credential, different paths |
| **`JSON.deserializeUntyped`** | Nested Concur JSON parsed without a typed class |

---

## Credential security note

`CLIENT_SECRET` and `REFRESH_TOKEN` are sensitive. In production, store in a **Protected Hierarchy Custom Setting** (field marked Encrypted) or an **External Credential Parameter** with `Protected` visibility — never hardcoded.
