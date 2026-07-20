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

The refresh_token is long-lived and company-scoped — it's the master credential. Store it in a **Protected Custom Setting** or **External Credential parameter**, not hardcoded in Apex.

## Auth — ConcurAuthService

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

## Service — ConcurExpenseService

Key design points:

- Implements `Schedulable` so it doubles as both a sync button target and a scheduled nightly job — same class, no duplication
- Uses **External IDs + upsert** so re-running is idempotent (no duplicate records)
- Two distinct API versions: `v3.0` for Expense Reports, `v4` for Travel Requests

```apex
public with sharing class ConcurExpenseService implements Schedulable {

    private static final String BASE_URL             = 'callout:Concur_API';
    private static final String EXPENSE_REPORTS_PATH = '/api/v3.0/expense/reports';
    private static final String TRAVEL_REQUESTS_PATH = '/travelrequest/v4/requests';

    // Called by the Salesforce scheduler
    public void execute(SchedulableContext ctx) {
        syncFromConcur();
    }

    @AuraEnabled
    public static void syncFromConcur() {
        String accessToken = ConcurAuthService.getAccessToken();
        fetchAndUpsertExpenseReports(accessToken);
        fetchAndUpsertTravelRequests(accessToken);
    }

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
}
```

## Scheduling the nightly sync

```apex
// Run once from Execute Anonymous to register:
String cron = '0 0 2 * * ?'; // 2 AM daily
System.schedule('Concur Nightly Sync', cron, new ConcurExpenseService());
```

## Named Credential setup

| Field | Value |
|-------|-------|
| Label / Name | `Concur_API` |
| URL | `https://us.api.concursolutions.com` |
| Authentication Protocol | No Authentication *(auth handled in Apex via Bearer token)* |
| Generate Authorization Header | Unchecked |

## Patterns demonstrated

| Pattern | How it appears here |
|---------|-------------------|
| **Refresh token grant** | `grant_type=refresh_token` — differs from Client Credentials (no user but not purely machine-credential) |
| **Schedulable + service class** | Same class handles both `execute(ctx)` and `@AuraEnabled` — single responsibility, two entry points |
| **Idempotent upsert** | External ID on `Concur_Report_Id__c` — sync is re-runnable, no duplicates |
| **Multi-version APIs** | v3.0 and v4 on same host — route by path, single Named Credential |
| **`JSON.deserializeUntyped`** | Nested JSON with variable shape — typed class would be fragile here |
| **`@AuraEnabled(cacheable=true)` + `refreshApex`** | Read method is cacheable; sync triggers `refreshApex` in LWC to bust cache |

## Credential security note

`CLIENT_SECRET` and `REFRESH_TOKEN` are the two sensitive values. In production:
- Store in a **Protected Hierarchy Custom Setting** (field marked Encrypted or hidden from non-admin)
- Or use an **External Credential Parameter** with the `Protected` visibility setting
- Never commit real values to source control — the Apex constants here are for demo clarity only
