---
title: Jira → Change Request Records
---

# Jira Defects → Salesforce Change Request Records

## Architecture

**Direction:** pull-based, Salesforce-initiated. Jira is the source; Salesforce creates/updates `Change_Request__c` records.

**Auth:** Jira Cloud supports two realistic options for a backend sync:
- **API token + Basic Auth** on a service account — most common in practice, simplest to set up. Not OAuth, but works.
- **OAuth 2.0 (3LO)** — Atlassian's real implementation is genuinely 3-legged (admin consents once interactively). After that, Atlassian issues a rotating `refresh_token`; the scheduled job uses it indefinitely. Closest fit to the "Authorization Code" flow in the OAuth table — but the human only logs in once during setup.

**Custom object:** `Change_Request__c`
- `Jira_Issue_Key__c` (Text, External ID, Unique) — e.g., `ENG-1042`
- `Summary__c`, `Status__c`, `Priority__c`, `Last_Synced__c`

## What fires the Apex

A **Schedulable** class registered via `System.schedule` — the scheduled job's clock tick. No button, no user action. The job wakes up, calls Jira, upserts records.

```apex
public class JiraDefectSyncSchedulable implements Schedulable {
    public void execute(SchedulableContext ctx) {
        Datetime lastSync = SyncTracker.getLastRunTime('Jira');
        String jql = 'project = ENG AND issuetype = Bug AND updated >= "'
            + lastSync.formatGmt('yyyy-MM-dd HH:mm') + '"';

        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:JiraCred/rest/api/3/search?jql='
            + EncodingUtil.urlEncode(jql, 'UTF-8'));
        req.setMethod('GET');
        HttpResponse res = new Http().send(req); // ← token attached silently here

        Map<String,Object> body = (Map<String,Object>) JSON.deserializeUntyped(res.getBody());
        List<Change_Request__c> toUpsert = new List<Change_Request__c>();

        for (Object o : (List<Object>) body.get('issues')) {
            Map<String,Object> issue  = (Map<String,Object>) o;
            Map<String,Object> fields = (Map<String,Object>) issue.get('fields');
            toUpsert.add(new Change_Request__c(
                Jira_Issue_Key__c = (String) issue.get('key'),
                Summary__c        = (String) fields.get('summary'),
                Status__c         = (String) ((Map<String,Object>) fields.get('status')).get('name'),
                Last_Synced__c    = Datetime.now()
            ));
        }
        upsert toUpsert Jira_Issue_Key__c; // idempotent — upsert on external ID
        SyncTracker.setLastRunTime('Jira', Datetime.now());
    }
}
```

## Near-real-time option (webhook complement)

Configure a Jira webhook (Project Settings → Webhooks) pointing at an Apex REST endpoint:

```apex
@RestResource(urlMapping='/jiraWebhook/*')
global with sharing class JiraWebhookHandler {
    @HttpPost
    global static void handleEvent() {
        RestRequest req = RestContext.request;
        Map<String,Object> body = (Map<String,Object>) JSON.deserializeUntyped(req.requestBody.toString());
        // parse and upsert Change_Request__c
    }
}
```

Keep the scheduled poll running as a reconciliation safety net for missed webhook deliveries.
