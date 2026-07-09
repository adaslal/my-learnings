---
title: Governor Limits
---

# Governor Limits

## Most critical per-transaction limits

| Limit | Synchronous | Asynchronous |
|-------|-------------|--------------|
| SOQL queries | 100 | 200 |
| SOQL query rows returned | 50,000 | 50,000 |
| DML statements | 150 | 150 |
| DML rows | 10,000 | 10,000 |
| CPU time | 10,000 ms | 60,000 ms |
| Heap size | 6 MB | 12 MB |
| Callouts | 100 | 100 |
| Future method calls | 50 | — |

## The cardinal rule

**No SOQL or DML inside loops.** Every violation of this is a ticking time bomb that fires at 200 records.

## Pattern: query once, loop over map

```apex
// Collect IDs first
Set<Id> accountIds = Trigger.newMap.keySet();

// Single query, store in map for O(1) lookup
Map<Id, Account> accountMap = new Map<Id, Account>(
    [SELECT Id, Name, OwnerId FROM Account WHERE Id IN :accountIds]
);

// Loop without touching the database
for (Account acc : Trigger.new) {
    Account fullAcc = accountMap.get(acc.Id);
    // ...
}
```

## Checking limits at runtime

```apex
System.debug('SOQL used: ' + Limits.getQueries() + ' / ' + Limits.getLimitQueries());
System.debug('DML used:  ' + Limits.getDmlStatements() + ' / ' + Limits.getLimitDmlStatements());
System.debug('CPU used:  ' + Limits.getCpuTime() + ' / ' + Limits.getLimitCpuTime());
```
