---
title: Flow & Trigger Execution Context
---

# Flow & Trigger Execution Context

One of the most common deep-dive questions. Know the distinction cold — interviewers use this to separate developers who follow patterns from those who understand the platform.

## What context do Flows run in?

**Flows run in System Mode without sharing by default.** This means:
- Object permissions are bypassed — Flow can read/write objects the running user normally can't
- FLS is bypassed — Flow can read/write fields the running user normally can't see
- Sharing rules are bypassed — Flow can access records outside the user's normal visibility

**The one nuance:** Screen Flow UI components like `lightning-record-edit-form` and `lightning-record-view-form` DO respect FLS for display purposes. The flow logic behind them does not.

### Can you change the Flow context?

Yes — since Summer '23, Record-Triggered Flows have a **Run As** setting on the Start element in Flow Builder. Three options:

| Run As | Who it runs as | When to use |
|--------|---------------|-------------|
| **System Context with Sharing** | System user — bypasses FLS/object perms, but respects sharing rules | Default. Recommended for most automations. |
| **System Context without Sharing** | Full system access — bypasses everything | Internal processes that must see all records (rollups, finance) |
| **Default User Context** | Running user — full FLS + object perms + sharing enforced | User-facing screen flows where security matters |

**Screen Flows (triggered by a user clicking):** always run in user context by default — the running user's permissions apply to all record operations inside the flow.

---

## What context do Triggers run in?

**Triggers always run in System Mode — there is no keyword to change this.** Object permissions, FLS, and sharing rules are all bypassed in trigger code.

**Sharing rules and triggers:** the trigger body itself runs without sharing. But if the trigger calls a handler class declared with `with sharing`, that class enforces sharing rules for SOQL and DML inside it. Object permissions and FLS are still bypassed either way — `with sharing` only controls record visibility, not field/object access.

### Can you make a trigger enforce user context?

Not directly. You enforce user context manually inside the trigger handler:

```apex
// Trigger body (always System Mode):
trigger AccountTrigger on Account (after insert) {
    AccountTriggerHandler.onAfterInsert(Trigger.new);
}

// Handler — with sharing enforces record-level visibility:
public with sharing class AccountTriggerHandler {
    public static void onAfterInsert(List<Account> newAccounts) {
        // SOQL here respects sharing rules for record access
        // But FLS and object-level permissions are still bypassed
        List<Account> visible = [SELECT Id, Name FROM Account WHERE Id IN :new Map<Id,Account>(newAccounts).keySet()];
    }
}
```

For FLS enforcement in triggers, use `WITH USER_MODE` in SOQL (Summer '23+):

```apex
// Enforces FLS + CRUD + sharing together
List<Account> accts = [SELECT Id, Name, Sensitive_Field__c FROM Account
                        WHERE Id IN :ids WITH USER_MODE];
```

---

## SOQL without WITH USER_MODE — silent failure or exception?

**Silent success.** If a user has no object access and Apex runs a SOQL without `WITH USER_MODE`, the query returns records as if the user had full access. No exception. No error. The user's profile and permission sets are completely ignored.

This is the classic security gap in Apex — code that looks safe because it's in a `with sharing` class, but still returns all records regardless of FLS.

**Correct approach (Summer '23+):**
```apex
// WITH USER_MODE enforces BOTH sharing AND FLS
[SELECT Id, Name FROM Account WHERE Id IN :ids WITH USER_MODE]

// Security.stripInaccessible — silently removes inaccessible fields (graceful)
SObjectAccessDecision decision = Security.stripInaccessible(
    AccessType.READABLE,
    [SELECT Id, Name, Sensitive__c FROM Account WHERE Id IN :ids]
);
```

---

## Quick reference matrix

| Component | Object Perms | FLS | Sharing Rules | Can change? |
|-----------|-------------|-----|---------------|-------------|
| Trigger body | Bypassed | Bypassed | Bypassed | No |
| `with sharing` handler called from trigger | Bypassed | Bypassed | Enforced | Partial |
| `WITH USER_MODE` in SOQL | Enforced | Enforced | Enforced | N/A |
| Flow (System Context with Sharing) | Bypassed | Bypassed | Enforced | Yes (Run As) |
| Flow (Default User Context) | Enforced | Enforced | Enforced | Yes (Run As) |
| Screen Flow (user-initiated) | Enforced | Enforced | Enforced | Yes (Run As) |
| Aura/LWC @AuraEnabled method | Depends on class sharing keyword | Depends | Depends | Yes |
