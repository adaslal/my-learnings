---
title: 11 Trigger Scenarios
---

# 11 Trigger Scenarios — Patterns for Every Interview

Each scenario follows the handler framework: **one trigger → handler class → service class**. The trigger is the entry point; the handler routes by event; service classes do the work.

**Golden rule:** Never put SOQL or DML inside a for loop. Always collect IDs into a Set/Map, query once outside the loop, DML once after.

---

## Scenario 1 — Prevent Duplicate Records (Email / Phone)

```apex
// Before Insert/Update on Contact
public class ContactDuplicateHandler {
    public static void preventDuplicateEmail(List<Contact> contacts) {
        Set<String> emails = new Set<String>();
        for (Contact c : contacts) {
            if (c.Email != null) emails.add(c.Email);
        }
        // one query for ALL emails
        Map<String, Contact> existing = new Map<String, Contact>();
        for (Contact c : [SELECT Id, Email FROM Contact WHERE Email IN :emails]) {
            existing.put(c.Email, c);
        }
        for (Contact c : contacts) {
            if (existing.containsKey(c.Email) && existing.get(c.Email).Id != c.Id) {
                c.addError('A Contact with this email already exists.');
            }
        }
    }
}
```

---

## Scenario 2 — Field Update on Child Records (Cascade Update)

```apex
// After Update on Account — when Rating changes, update all related Opportunities
public class AccountRatingCascade {
    public static void cascadeRating(List<Account> newList, Map<Id, Account> oldMap) {
        List<Opportunity> toUpdate = new List<Opportunity>();
        Set<Id> changedAcctIds = new Set<Id>();

        for (Account a : newList) {
            if (a.Rating != oldMap.get(a.Id).Rating) changedAcctIds.add(a.Id);
        }
        if (changedAcctIds.isEmpty()) return;

        Map<Id, Account> accountMap = new Map<Id, Account>(
            [SELECT Id, Rating FROM Account WHERE Id IN :changedAcctIds]);

        for (Opportunity opp : [SELECT Id, AccountId FROM Opportunity WHERE AccountId IN :changedAcctIds]) {
            opp.Rating__c = accountMap.get(opp.AccountId).Rating;
            toUpdate.add(opp);
        }
        if (!toUpdate.isEmpty()) update toUpdate;
    }
}
```

---

## Scenario 3 — Rollup Summary on Lookup (Manual Rollup)

Rollup Summary fields only work on Master-Detail. For Lookup relationships, write a trigger on the child.

```apex
// After Insert/Update/Delete on Case — roll up count to Account
public class CaseRollupService {
    public static void rollupToAccount(Set<Id> accountIds) {
        Map<Id, Integer> countMap = new Map<Id, Integer>();
        for (AggregateResult ar : [
            SELECT AccountId, COUNT(Id) cnt FROM Case
            WHERE AccountId IN :accountIds GROUP BY AccountId
        ]) {
            countMap.put((Id)ar.get('AccountId'), (Integer)ar.get('cnt'));
        }
        List<Account> toUpdate = new List<Account>();
        for (Id aId : accountIds) {
            toUpdate.add(new Account(Id = aId, Open_Cases__c = countMap.containsKey(aId) ? countMap.get(aId) : 0));
        }
        update toUpdate;
    }
}
```

---

## Scenario 4 — Send Email Notifications on Record Change

```apex
// After Update on Opportunity — email owner when Stage → Closed Won
public static void emailOnClosedWon(List<Opportunity> newList, Map<Id, Opportunity> oldMap) {
    List<Messaging.SingleEmailMessage> emails = new List<Messaging.SingleEmailMessage>();
    for (Opportunity opp : newList) {
        if (opp.StageName == 'Closed Won' && oldMap.get(opp.Id).StageName != 'Closed Won') {
            Messaging.SingleEmailMessage email = new Messaging.SingleEmailMessage();
            email.setTargetObjectId(opp.OwnerId);  // avoids email limit issues
            email.setSubject('Closed Won: ' + opp.Name);
            email.setPlainTextBody('Congratulations! ' + opp.Name + ' is now Closed Won.');
            emails.add(email);
        }
    }
    if (!emails.isEmpty()) Messaging.sendEmail(emails);
}
```

---

## Scenario 5 — Auto-Create Child Records on Insert

```apex
// After Insert on Account — create default Contact and Task
// AFTER INSERT because you need the Account Id
public static void createDefaultRecords(List<Account> accounts) {
    List<Contact> contacts = new List<Contact>();
    List<Task> tasks = new List<Task>();
    for (Account a : accounts) {
        contacts.add(new Contact(LastName = 'Primary', AccountId = a.Id, Email = a.Phone + '@placeholder.com'));
        tasks.add(new Task(Subject = 'Onboarding call', WhatId = a.Id, ActivityDate = Date.today().addDays(3)));
    }
    insert contacts;
    insert tasks;
}
```

---

## Scenario 6 — Prevent Record Deletion (Conditional)

```apex
// Before Delete on Account — block if open Opportunities exist
public static void blockDeleteWithOpenOpps(List<Account> accounts) {
    Set<Id> acctIds = new Map<Id, Account>(accounts).keySet();
    Map<Id, List<Opportunity>> oppsByAccount = new Map<Id, List<Opportunity>>();
    for (Opportunity opp : [SELECT AccountId FROM Opportunity WHERE AccountId IN :acctIds AND IsClosed = false]) {
        if (!oppsByAccount.containsKey(opp.AccountId)) oppsByAccount.put(opp.AccountId, new List<Opportunity>());
        oppsByAccount.get(opp.AccountId).add(opp);
    }
    for (Account a : accounts) {  // use Trigger.old — Trigger.new is null on delete
        if (oppsByAccount.containsKey(a.Id)) {
            a.addError('Cannot delete an Account with open Opportunities.');
        }
    }
}
```

---

## Scenario 7 — Update Lookup Fields (Primary Contact Management)

```apex
// After Insert/Update on Contact — when Primary__c = true, update Account lookup
// and set all other Contacts for that Account to Primary__c = false
public static void managePrimaryContact(List<Contact> contacts, Map<Id, Contact> oldMap) {
    Set<Id> accountIds = new Set<Id>();
    for (Contact c : contacts) {
        if (c.Primary__c && (oldMap == null || !oldMap.get(c.Id).Primary__c)) {
            accountIds.add(c.AccountId);
        }
    }
    if (accountIds.isEmpty()) return;

    // Get all Contacts for these accounts
    List<Contact> allContacts = [SELECT Id, AccountId, Primary__c FROM Contact WHERE AccountId IN :accountIds];
    List<Account> accountsToUpdate = new List<Account>();
    List<Contact> contactsToUpdate = new List<Contact>();

    for (Contact c : contacts) {
        if (c.Primary__c) accountsToUpdate.add(new Account(Id = c.AccountId, Primary_Contact__c = c.Id));
    }
    for (Contact c : allContacts) {
        boolean isCurrentPrimary = false;
        for (Contact trigger_c : contacts) {
            if (trigger_c.Id == c.Id && trigger_c.Primary__c) { isCurrentPrimary = true; break; }
        }
        if (!isCurrentPrimary && c.Primary__c) {
            contactsToUpdate.add(new Contact(Id = c.Id, Primary__c = false));
        }
    }
    if (!accountsToUpdate.isEmpty()) update accountsToUpdate;
    if (!contactsToUpdate.isEmpty()) update contactsToUpdate;
}
```

---

## Scenario 8 — Profile-Based Field Validation

```apex
// Before Insert/Update — only Sales Managers can set Discount__c > 20%
// DANGER: prefer Custom Permissions over profile checks (profile names change)
public static void enforceDiscountLimit(List<Opportunity> opps) {
    Boolean canOverride = FeatureManagement.checkPermission('Override_Discount_Limit');
    for (Opportunity opp : opps) {
        if (!canOverride && opp.Discount__c > 20) {
            opp.addError('Discount above 20% requires Sales Manager approval.');
        }
    }
}
```

---

## Scenario 9 — Auto-Create Tasks on Record Changes

```apex
// After Update on Case — create high-priority Task when Status → Escalated
public static void createEscalationTask(List<Case> newList, Map<Id, Case> oldMap) {
    List<Task> tasks = new List<Task>();
    for (Case c : newList) {
        if (c.Status == 'Escalated' && oldMap.get(c.Id).Status != 'Escalated') {
            tasks.add(new Task(
                Subject = 'Follow up on escalated case',
                WhatId = c.Id,
                OwnerId = c.OwnerId,
                Priority = 'High',
                ActivityDate = Date.today()
            ));
        }
    }
    if (!tasks.isEmpty()) insert tasks;
}
```

---

## Scenario 10 — Complex Validation (Credit Limit)

```apex
// Before Insert/Update on Order — validate Account credit limit isn't exceeded
public static void validateCreditLimit(List<Order> orders) {
    Set<Id> accountIds = new Set<Id>();
    for (Order o : orders) accountIds.add(o.AccountId);

    Map<Id, Account> accounts = new Map<Id, Account>(
        [SELECT Id, Credit_Limit__c FROM Account WHERE Id IN :accountIds]);

    Map<Id, Decimal> existingOrderTotals = new Map<Id, Decimal>();
    for (AggregateResult ar : [
        SELECT AccountId, SUM(TotalAmount) total FROM Order
        WHERE AccountId IN :accountIds AND Status != 'Cancelled'
        GROUP BY AccountId
    ]) {
        existingOrderTotals.put((Id)ar.get('AccountId'), (Decimal)ar.get('total'));
    }

    for (Order o : orders) {
        Decimal limit = accounts.get(o.AccountId).Credit_Limit__c ?? 0;
        Decimal existing = existingOrderTotals.get(o.AccountId) ?? 0;
        if ((existing + o.TotalAmount) > limit) {
            o.addError('This order exceeds the Account\'s credit limit of ' + limit);
        }
    }
}
```

---

## Scenario 11 — Recursion Control (Prevent Infinite Loops)

Two proven patterns. Know both and when each applies.

### Static Boolean — simple, all-or-nothing

```apex
public class TriggerRecursionGuard {
    public static Boolean hasRun = false;
}

// In handler:
if (TriggerRecursionGuard.hasRun) return;
TriggerRecursionGuard.hasRun = true;
try {
    // ... trigger logic ...
} finally {
    TriggerRecursionGuard.hasRun = false;  // always reset
}
```

**Danger:** Static variables persist for the lifetime of the transaction. Boolean guard: always use try/finally to reset, or subsequent trigger calls are silently skipped.

### Static Set\<Id\> — precise, per-record

```apex
public class TriggerRecursionGuard {
    public static Set<Id> processedIds = new Set<Id>();
}

// In handler:
List<Account> toProcess = new List<Account>();
for (Account a : Trigger.new) {
    if (!TriggerRecursionGuard.processedIds.contains(a.Id)) {
        TriggerRecursionGuard.processedIds.add(a.Id);
        toProcess.add(a);
    }
}
// Only process toProcess — already-seen records are skipped
```

**Set\<Id\> is better when:** you need to process a record the first time it's encountered but skip it on recursive fires. No reset needed — once an Id is in the Set it stays there for the transaction, which is exactly the intended behavior.

---

## Scenario 12 — Account Insert: Create Owner Contact (with Duplicate Email Check)

```apex
// After Insert on Account — create Contact from Account Owner
// Block Account creation if a Contact with owner's email already exists
public static void createOwnerContact(List<Account> accounts) {
    Set<Id> ownerIds = new Set<Id>();
    for (Account a : accounts) ownerIds.add(a.OwnerId);

    Map<Id, User> owners = new Map<Id, User>(
        [SELECT Id, FirstName, LastName, Email FROM User WHERE Id IN :ownerIds]);

    Set<String> ownerEmails = new Set<String>();
    for (User u : owners.values()) if (u.Email != null) ownerEmails.add(u.Email);

    Set<String> existingEmails = new Set<String>();
    for (Contact c : [SELECT Email FROM Contact WHERE Email IN :ownerEmails]) {
        existingEmails.add(c.Email);
    }

    List<Contact> toInsert = new List<Contact>();
    for (Account a : accounts) {
        User owner = owners.get(a.OwnerId);
        if (existingEmails.contains(owner.Email)) {
            a.addError('A Contact with the owner\'s email already exists: ' + owner.Email);
        } else {
            toInsert.add(new Contact(
                FirstName = owner.FirstName, LastName = owner.LastName,
                Email = owner.Email, AccountId = a.Id
            ));
        }
    }
    if (!toInsert.isEmpty()) insert toInsert;
}
```

---

## Scenario 13 — Opportunity Closed Won: Email All Team Members Once

```apex
// After Update on Opportunity — email ALL team members when Stage → Closed Won
// Static Set<Id> ensures the email fires exactly once per Opportunity per transaction
public class OpportunityTeamEmailer {
    private static Set<Id> emailedOpps = new Set<Id>();

    public static void emailTeamOnClosedWon(List<Opportunity> newList, Map<Id, Opportunity> oldMap) {
        Set<Id> oppIds = new Set<Id>();
        for (Opportunity opp : newList) {
            if (opp.StageName == 'Closed Won' && oldMap.get(opp.Id).StageName != 'Closed Won'
                && !emailedOpps.contains(opp.Id)) {
                oppIds.add(opp.Id);
                emailedOpps.add(opp.Id);
            }
        }
        if (oppIds.isEmpty()) return;

        Map<Id, List<OpportunityTeamMember>> teamMap = new Map<Id, List<OpportunityTeamMember>>();
        for (OpportunityTeamMember otm : [SELECT OpportunityId, UserId FROM OpportunityTeamMember WHERE OpportunityId IN :oppIds]) {
            if (!teamMap.containsKey(otm.OpportunityId)) teamMap.put(otm.OpportunityId, new List<OpportunityTeamMember>());
            teamMap.get(otm.OpportunityId).add(otm);
        }

        List<Messaging.SingleEmailMessage> emails = new List<Messaging.SingleEmailMessage>();
        for (Id oppId : oppIds) {
            List<OpportunityTeamMember> team = teamMap.get(oppId);
            if (team == null || team.isEmpty()) continue;
            for (OpportunityTeamMember member : team) {
                Messaging.SingleEmailMessage email = new Messaging.SingleEmailMessage();
                email.setTargetObjectId(member.UserId);
                email.setSubject('Closed Won!');
                email.setPlainTextBody('Great news! The opportunity has been won.');
                emails.add(email);
            }
        }
        if (!emails.isEmpty()) Messaging.sendEmail(emails);
    }
}
```
