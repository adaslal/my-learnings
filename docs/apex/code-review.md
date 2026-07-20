---
title: Code Review Practices
---

# Apex Code Review — What to Check

A structured checklist for reviewing Apex code, covering the categories that catch real production issues. Use this both for reviewing others' work and for self-review before opening a PR.

---

## 1. Bulkification (most common failure)

**Rule: no SOQL or DML inside a loop, ever.**

```apex
// ❌ Classic trigger mistake — queries per record
for (Opportunity opp : Trigger.new) {
    Account acc = [SELECT Id, Name FROM Account WHERE Id = :opp.AccountId]; // SOQL in loop
    acc.Last_Opp_Amount__c = opp.Amount;
    update acc; // DML in loop
}

// ✅ Correct — collect IDs first, query once, update once
Map<Id, Account> accountMap = new Map<Id, Account>(
    [SELECT Id, Name FROM Account WHERE Id IN :Trigger.new.collect('AccountId')]
);
List<Account> toUpdate = new List<Account>();
for (Opportunity opp : Trigger.new) {
    Account acc = accountMap.get(opp.AccountId);
    if (acc != null) {
        acc.Last_Opp_Amount__c = opp.Amount;
        toUpdate.add(acc);
    }
}
update toUpdate;
```

**Signs of bulkification issues in a review:**
- `[SELECT ...]` inside a `for` loop body
- `insert`/`update`/`delete` inside a `for` loop body
- Callouts inside a `for` loop (each callout is a separate governor limit hit)
- A method that takes a single `Id` parameter (instead of a `Set<Id>`) called from a trigger

---

## 2. Governor limit awareness

Check the actual numbers when reviewing integration or complex logic code:

| Resource | Limit (per transaction) |
|----------|------------------------|
| SOQL queries | 100 |
| SOQL query rows returned | 50,000 |
| DML statements | 150 |
| DML rows | 10,000 |
| Apex callouts | 100 |
| CPU time | 10,000 ms |
| Heap size | 6 MB (async: 12 MB) |
| Future calls | 50 |
| Queueable enqueue | 50 |

**Review checkpoints:**
- Is there a realistic path to hitting 100 SOQL queries? (Count method calls that contain queries, not just inline queries)
- Are large Lists/Maps being built that could blow heap in a bulk scenario?
- Callout count — if a method calls an external API in a loop, flag it

---

## 3. Security

### FLS / CRUD enforcement

```apex
// ✅ Current best practice — WITH USER_MODE (API v67+)
// Enforces FLS, CRUD, AND sharing in one clause
// Throws with all inaccessible fields listed in e.getInaccessibleFields()
List<Contact> contacts = [SELECT Id, Name, SSN__c FROM Contact WITH USER_MODE];

// ✅ Alternative — graceful degradation (silently strips inaccessible fields)
SObjectAccessDecision decision = Security.stripInaccessible(
    AccessType.READABLE,
    [SELECT Id, Name, SSN__c FROM Contact]
);
List<Contact> safeContacts = (List<Contact>) decision.getRecords();

// ❌ WITH SECURITY_ENFORCED — removed in API v67 (Summer '26), won't compile
List<Contact> contacts = [SELECT Id, Name FROM Contact WITH SECURITY_ENFORCED]; // compile error v67+
```

**Review checkpoint:** Any SOQL on sensitive objects (Contact, Lead, Financial records, custom objects with PII) should have either `WITH USER_MODE` or `Security.stripInaccessible` wrapping the result.

### Sharing keywords

```apex
// Always declare explicitly — never rely on the default
public with sharing class ContactController { }     // enforces record-level sharing
public without sharing class BatchHelper { }        // bypasses sharing (must justify)
public inherited sharing class ServiceHelper { }    // takes on caller's sharing context
```

**Review checkpoint:** Every Apex class should have an explicit sharing keyword. `without sharing` should have a comment explaining why.

### Hardcoded IDs — always a red flag

```apex
// ❌ Never do this
String profileId = '00e000000000001'; // breaks in every sandbox/production

// ✅
Profile p = [SELECT Id FROM Profile WHERE Name = 'System Administrator' LIMIT 1];
```

---

## 4. Error handling

```apex
// ❌ Silently swallows the exception — worst possible pattern
try {
    ExternalService.callout(recordId);
} catch (Exception e) {
    // nothing here — caller has no idea it failed
}

// ✅ Log and surface
try {
    ExternalService.callout(recordId);
} catch (Exception e) {
    System.debug(LoggingLevel.ERROR, 'Callout failed for ' + recordId + ': ' + e.getMessage());
    // Option 1: rethrow for the caller to handle
    throw new AuraHandledException('Sync failed: ' + e.getMessage());
    // Option 2: add to Database.SaveResult error list, log to custom object, etc.
}
```

**Review checkpoints:**
- `catch (Exception e) {}` with an empty body is always a bug — flag it
- Does the class have a custom exception type (`public class MyException extends Exception {}`)? Typed exceptions make error handling at the call site cleaner
- For integrations: are HTTP status codes other than 200 handled, or does the code assume success?

---

## 5. Test quality (75% isn't the bar — outcomes are)

```apex
// ❌ Coverage-only test — tells you nothing
@IsTest
static void testMethod() {
    new MyService().doWork(); // no asserts, just runs the code
}

// ✅ Outcome-focused test
@IsTest
static void testSyncCreatesRecord() {
    // Setup: build test data with Test.setMock() for callouts
    Test.setMock(HttpCalloutMock.class, new MyApiMock());
    Account acc = new Account(Name = 'Test Co');
    insert acc;

    Test.startTest();
    MyService.sync(acc.Id);
    Test.stopTest();

    // Assert on the actual outcome
    List<My_Custom__c> synced = [SELECT Id, External_Id__c FROM My_Custom__c WHERE Account__c = :acc.Id];
    System.assertEquals(1, synced.size(), 'Expected exactly one synced record');
    System.assertEquals('EXT-001', synced[0].External_Id__c, 'External ID should match mock response');
}
```

**Review checkpoints:**
- Every test method should have at least one `System.assert*` call
- Bulk test: does any test insert 200 records and verify the bulk path works?
- Negative test: is there a test for invalid input, failed callout, or missing data?
- `Test.startTest()` / `Test.stopTest()` wrapping async/callout code — present?

---

## 6. Idempotency for integrations and async

**Integrations should be safe to re-run** — if the same job fires twice (network retry, scheduler overlap), it shouldn't create duplicate records.

```apex
// ✅ Upsert on External ID — re-runnable, no duplicates
External_Record__c rec = new External_Record__c(
    External_Id__c = externalId,  // External ID field, marked unique
    Name           = payload.name,
    Amount__c      = payload.amount
);
upsert rec External_Record__c.External_Id__c;
```

**Review checkpoint:** Any code that syncs from an external system should use `upsert` on an External ID, not `insert` with a pre-check query.

---

## 7. Naming and readability

- Method names should state what they do: `syncExpenseReports()` not `run()` or `execute()`
- Variable names should be meaningful: `accountsByOwnerId` not `map1`
- No dead code — commented-out blocks should be deleted before merge
- Constants named in `UPPER_SNAKE_CASE` and placed at the top of the class
- Method length: if a method is > ~40 lines, consider extracting helpers

---

## Quick review checklist

Before approving any Apex PR:

- [ ] No SOQL/DML inside loops
- [ ] Governor limits checked for bulk scenarios (200 records)
- [ ] Explicit `with sharing` / `without sharing` on every class
- [ ] FLS/CRUD enforcement on queries (`WITH USER_MODE` or `stripInaccessible`) for user-facing data
- [ ] No hardcoded IDs
- [ ] No empty catch blocks
- [ ] Test methods have `System.assert*` calls
- [ ] At least one bulk test (200 records)
- [ ] External sync uses `upsert` on External ID (not insert + existence check)
- [ ] `WITH SECURITY_ENFORCED` not present (removed in API v67)
