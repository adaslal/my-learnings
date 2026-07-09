---
title: Async Apex
---

# Async Apex

## When to use what

| Pattern | Use when |
|---------|----------|
| `@future` | Simple one-off callout or DML that can't run synchronously. Max 50/transaction. No chaining. |
| `Queueable` | Need to chain jobs, pass complex objects, or want a job ID for monitoring. Preferred over `@future`. |
| `Batchable` | Processing large record sets (>10k rows). Up to 50M records, 200 per chunk. |
| `Schedulable` | Running Apex on a cron schedule (nightly batch, hourly sync). |

## Queueable (preferred async pattern)

```apex
public class SyncTimecardJob implements Queueable, Database.AllowsCallouts {
    private Id projectId;

    public SyncTimecardJob(Id projectId) {
        this.projectId = projectId;
    }

    public void execute(QueueableContext ctx) {
        // Do work — can make callouts, DML, chain another job
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ExternalCred/api/timecards?projectId=' + projectId);
        req.setMethod('GET');
        HttpResponse res = new Http().send(req);
        // process res...

        // Chain next job if needed (1 chain per execute allowed)
        // System.enqueueJob(new AnotherJob());
    }
}

// Trigger it:
System.enqueueJob(new SyncTimecardJob(someProjectId));
```

## Batch Apex

```apex
public class CleanupBatch implements Database.Batchable<SObject>, Database.Stateful {
    public Integer processed = 0; // Stateful — survives across chunks

    public Database.QueryLocator start(Database.BatchableContext bc) {
        return Database.getQueryLocator('SELECT Id FROM Contact WHERE Email = null');
    }

    public void execute(Database.BatchableContext bc, List<Contact> scope) {
        for (Contact c : scope) { c.Email = 'unknown@placeholder.com'; }
        update scope;
        processed += scope.size();
    }

    public void finish(Database.BatchableContext bc) {
        System.debug('Processed: ' + processed);
    }
}

// Run it:
Database.executeBatch(new CleanupBatch(), 200); // 200 = chunk size
```

## Governor limits to know

| Limit | Value |
|-------|-------|
| `@future` calls per transaction | 50 |
| Queueable jobs enqueued per transaction | 50 (1 from within execute) |
| Batch chunk size max | 2,000 |
| Scheduled jobs (Schedulable) active | 100 |
| Callouts per transaction | 100 |
