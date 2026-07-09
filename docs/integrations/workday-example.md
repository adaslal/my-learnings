---
title: Workday → User & Contact Provisioning
---

# Workday → Salesforce User & Contact Provisioning

## Architecture

**Direction A (primary):** Salesforce-initiated nightly pull — Salesforce calls Workday's RaaS endpoint or `Get_Workers` operation for workers changed since the last run.

**Direction B (alternative):** Workday-initiated push — Workday Studio/EIB calls Salesforce's Apex REST endpoint when a "Hire" Business Process step completes.

**Auth (Direction A — Client Credentials):**  
Workday supports OAuth 2.0 Client Credentials via an **Integration System User (ISU)** — a dedicated service account scoped to only the domains it needs (e.g., read-only "Worker Data"). Configure via Workday Setup: Register API Client → Grant Category = Client Credentials → bound to ISU. Gives Client ID, Client Secret, Token URL → paste into Salesforce External Credential.

**Auth (Direction B — JWT Bearer):**  
Workday authenticates INTO Salesforce. Setup: Salesforce admin creates an **External Client App** (Setup → External Client App Manager → New → enable OAuth → Use digital signatures → upload the public cert Workday's team provides). Consumer Key → goes in JWT `iss` claim. Workday Studio signs the JWT with the private key, exchanges it for a Salesforce access token, then calls the Apex REST endpoint.

## Direction A — Batch Apex pull

```apex
public class Workday_WorkerSyncBatch implements Database.Batchable<Object>, Database.AllowsCallouts {
    public Object start(Database.BatchableContext bc) {
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:WorkdayCred/ccx/service/customreport2/tenant/workers_changed?format=json');
        req.setMethod('GET');
        HttpResponse res = new Http().send(req); // ← Client Credentials token attached silently
        Map<String,Object> body = (Map<String,Object>) JSON.deserializeUntyped(res.getBody());
        return (List<Object>) body.get('Report_Entry');
    }

    public void execute(Database.BatchableContext bc, List<Object> scope) {
        List<Contact> toUpsert = new List<Contact>();
        for (Object o : scope) {
            Map<String,Object> worker = (Map<String,Object>) o;
            toUpsert.add(new Contact(
                Workday_Worker_ID__c = (String) worker.get('Employee_ID'),
                FirstName            = (String) worker.get('First_Name'),
                LastName             = (String) worker.get('Last_Name'),
                Email                = (String) worker.get('Email')
            ));
            // conditionally build User record if worker.get('Needs_Platform_Access') == true
        }
        upsert toUpsert Workday_Worker_ID__c;
    }

    public void finish(Database.BatchableContext bc) {}
}
```

## Offboarding

The same batch checks `Termination_Date__c` populated → sets `IsActive = false` on the Salesforce User. Never delete Users — deactivation preserves audit history and record ownership.

## Client Credentials vs JWT Bearer — the core difference

| | Client Credentials | JWT Bearer |
|--|--------------------|-----------|
| What's transmitted | client_id + client_secret (shared password) | Signed JWT assertion (no secret crosses the wire) |
| Risk | If the secret leaks from either side, anyone can impersonate | Private key never leaves the signer — nothing symmetric to leak |
| Setup complexity | Lower | Higher (cert generation, External Client App) |
| Preferred when | Speed matters, lower-sensitivity data | Enterprise/security-conscious environments |
