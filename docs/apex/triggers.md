---
title: Triggers
---

# Apex Triggers

## Handler Pattern (always use this)

```apex
trigger AccountTrigger on Account (before insert, before update, after insert, after update) {
    AccountTriggerHandler.run();
}

public with sharing class AccountTriggerHandler {
    public static void run() {
        if (Trigger.isBefore && Trigger.isInsert) beforeInsert(Trigger.new);
        if (Trigger.isAfter  && Trigger.isInsert) afterInsert(Trigger.new);
        if (Trigger.isBefore && Trigger.isUpdate) beforeUpdate(Trigger.new, Trigger.oldMap);
        if (Trigger.isAfter  && Trigger.isUpdate) afterUpdate(Trigger.new, Trigger.oldMap);
    }

    private static void beforeInsert(List<Account> newList) { /* ... */ }
    private static void afterInsert(List<Account> newList) { /* ... */ }
    private static void beforeUpdate(List<Account> newList, Map<Id, Account> oldMap) { /* ... */ }
    private static void afterUpdate(List<Account> newList, Map<Id, Account> oldMap) { /* ... */ }
}
```

## Recursion Guard

```apex
public class TriggerHelper {
    private static Set<Id> processedIds = new Set<Id>();

    public static List<SObject> filterUnprocessed(List<SObject> records) {
        List<SObject> toProcess = new List<SObject>();
        for (SObject rec : records) {
            if (!processedIds.contains(rec.Id)) {
                processedIds.add(rec.Id);
                toProcess.add(rec);
            }
        }
        return toProcess;
    }
}
```

## Bulkification Rules

- **Never** put SOQL or DML inside a loop.
- Collect IDs in a Set, query once outside the loop, put results in a Map, then loop.
- Always handle up to 200 records (Trigger.new can contain up to 200).

```apex
// Wrong
for (Account acc : Trigger.new) {
    List<Contact> contacts = [SELECT Id FROM Contact WHERE AccountId = :acc.Id]; // SOQL in loop!
}

// Right
Set<Id> accountIds = new Map<Id, Account>(Trigger.new).keySet();
Map<Id, List<Contact>> contactsByAccount = new Map<Id, List<Contact>>();
for (Contact c : [SELECT Id, AccountId FROM Contact WHERE AccountId IN :accountIds]) {
    if (!contactsByAccount.containsKey(c.AccountId)) contactsByAccount.put(c.AccountId, new List<Contact>());
    contactsByAccount.get(c.AccountId).add(c);
}
```

## Summer '26 — Triggers always run in System Mode

Triggers no longer accept a sharing keyword (any API version). If a trigger body needs sharing-sensitive logic, put it in a handler class with `with sharing`.

## When to use before vs after

| Context | Use |
|---------|-----|
| Set/validate field values before save | `before insert / before update` |
| Create related records after an Id exists | `after insert` |
| Callouts, async chains, cross-object updates | `after insert / after update` |
| Never do callouts synchronously in a trigger | Use `@future(callout=true)` or Queueable |
