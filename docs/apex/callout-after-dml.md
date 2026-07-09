---
title: Callout After DML — 4 Patterns
---

# Callout After DML — All 4 Patterns

## Why this fails naively

The Salesforce platform blocks HTTP callouts if a transaction has **uncommitted DML**. Doing DML then a callout in the same synchronous method throws:

```
System.CalloutException: You have uncommitted work pending. Please commit or rollback before calling out.
```

The fix is always to separate the DML commit from the callout — each pattern below does this differently.

## Pattern 1 — @future(callout=true) — Simplest

```apex
// Trigger or service class — after DML completes:
public class OrderService {
    public static void saveAndNotify(Order o) {
        insert o;  // DML commits in this transaction
        notifyErpAsync(o.Id);  // fires in a new transaction after this one closes
    }

    @future(callout=true)
    public static void notifyErpAsync(Id orderId) {
        Order o = [SELECT Id, OrderNumber FROM Order WHERE Id = :orderId];
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ErpNC/orders');
        req.setMethod('POST');
        req.setBody(JSON.serialize(o));
        new Http().send(req);
    }
}
```

**DANGER — @future parameter constraint:** Parameters must be **primitives** or collections of primitives (String, Id, Integer, Boolean). You cannot pass an SObject or custom Apex class. Serialize complex data to JSON String before passing, deserialize inside the @future method.

**When to use:** Simple, fire-and-forget callouts. Single record. No chaining needed.

## Pattern 2 — Queueable + Database.AllowsCallouts — Recommended

```apex
public class ErpSyncQueueable implements Queueable, Database.AllowsCallouts {
    private Id orderId;
    private Integer attempt;

    public ErpSyncQueueable(Id orderId, Integer attempt) {
        this.orderId = orderId;
        this.attempt = attempt;
    }

    public void execute(QueueableContext ctx) {
        Order o = [SELECT Id, OrderNumber, TotalAmount FROM Order WHERE Id = :orderId];
        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:ErpNC/orders');
        req.setMethod('POST');
        req.setBody(JSON.serialize(o));
        try {
            HttpResponse res = new Http().send(req);
            if (res.getStatusCode() != 200 && attempt < 3) {
                // retry — exponential back-off via re-enqueue
                System.enqueueJob(new ErpSyncQueueable(orderId, attempt + 1));
            }
        } catch (CalloutException e) {
            // log failure to custom object
        }
    }
}

// Enqueue from trigger (after the DML transaction closes, trigger fires Queueable):
trigger OrderTrigger on Order (after insert) {
    for (Order o : Trigger.new) {
        System.enqueueJob(new ErpSyncQueueable(o.Id, 1));
    }
}
```

**Why Queueable is preferred over @future:** accepts complex object parameters, chainable, monitorable in Apex Jobs UI, supports retry logic with attempt counter.

## Pattern 3 — Platform Events — Most Decoupled

```apex
// Publisher (in trigger — publishes event, doesn't wait for consumer)
trigger OrderTrigger on Order (after insert) {
    List<Order_Created__e> events = new List<Order_Created__e>();
    for (Order o : Trigger.new) {
        events.add(new Order_Created__e(Order_Id__c = o.Id));
    }
    EventBus.publish(events);
}

// Subscriber (separate trigger on the Platform Event — runs in own transaction)
trigger OrderCreatedEventTrigger on Order_Created__e (after insert) {
    for (Order_Created__e evt : Trigger.new) {
        // make callout here — separate transaction, no DML conflict
        ErpSyncService.syncOrder(evt.Order_Id__c);
    }
}
```

**Why most decoupled:** the publisher has zero knowledge of who subscribes. Multiple consumers can react to the same event independently. Event bus guarantees at-least-once delivery with 72-hour replay window.

**Design your consumer to be idempotent** — at-least-once means the same event may arrive twice after a transient failure. Use an External ID field on the target record and upsert, never blind insert.

## Pattern 4 — After-Save Record-Triggered Flow → Apex Action

```
After-Save Flow (triggers on Order insert)
  → Apex Action (calls System.enqueueJob internally)
    → Queueable handles the callout
```

Best for admin-friendly no-code trigger points. The Flow handles the "when to fire" declaratively; the Apex Action handles the "what to do" programmatically. Net result: same as Pattern 2 but the trigger is a Flow instead of an Apex trigger.

## Pattern comparison

| | @future | Queueable | Platform Events | Flow + Apex Action |
|--|---------|-----------|-----------------|-------------------|
| Complexity | Lowest | Medium | Medium | Medium |
| Object params | No (primitives only) | Yes | Limited (event fields) | Yes |
| Chainable | No | Yes | No | No |
| Retry | Manual (re-enqueue) | Yes | N/A | Manual |
| Multiple subscribers | No | No | Yes | No |
| Monitoring | Limited | Apex Jobs UI | Event logs | Flow logs + Apex Jobs |
| Use when | Simple single callout | Most cases | Fan-out, decoupling | Admin trigger needed |

## Retry with exponential back-off

```apex
public class RetryQueueable implements Queueable, Database.AllowsCallouts {
    private Id recordId;
    private Integer attempt;
    private static final Integer MAX_ATTEMPTS = 3;

    public RetryQueueable(Id recordId, Integer attempt) {
        this.recordId = recordId;
        this.attempt = attempt;
    }

    public void execute(QueueableContext ctx) {
        try {
            HttpResponse res = makeCallout(recordId);
            if (res.getStatusCode() >= 500 && attempt < MAX_ATTEMPTS) {
                // server error — retry with back-off
                System.enqueueJob(new RetryQueueable(recordId, attempt + 1));
            } else if (res.getStatusCode() >= 400) {
                logFailure(recordId, res.getBody(), attempt);
            }
        } catch (CalloutException e) {
            if (attempt < MAX_ATTEMPTS) {
                System.enqueueJob(new RetryQueueable(recordId, attempt + 1));
            } else {
                logFailure(recordId, e.getMessage(), attempt);
            }
        }
    }
}
```

**Note:** You cannot `Thread.sleep()` in Apex. The natural delay between retry attempts comes from Flex Queue scheduling, not a fixed timer. For a proper timed delay, use a Schedulable that fires at a specific time.
