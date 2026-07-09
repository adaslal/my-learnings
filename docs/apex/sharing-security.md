---
title: Sharing & Security
---

# Apex Sharing & Security

## The Two Separate Layers

FLS/CRUD (can this user see this field/object?) and record-level sharing (can this user see this particular record?) are **independent layers**. Both matter; neither covers the other.

## with sharing / without sharing / inherited sharing

| Keyword | Behaviour |
|---------|-----------|
| `with sharing` | Enforces OWD, role hierarchy, sharing rules, manual/team shares. Records outside the user's access are excluded from queries and DML. |
| `without sharing` | Bypasses record-level sharing entirely. Sees and can act on every record. Does **not** affect FLS/CRUD. |
| `inherited sharing` | Takes on the caller's sharing mode. Safety net: when invoked as an entry point with no Apex caller (LWC/Aura controller, VF controller, Apex REST, async), defaults to `with sharing`. |
| *(omitted)* | **Before Summer '26 (API ≤ v66):** silently defaulted to `without sharing` at entry points — the classic gotcha. **Summer '26 (API v67+):** now defaults to `with sharing`. Best practice either way: always declare explicitly, never rely on the default. |

### Summer '26 (API v67) changes — know these cold

- **Default execution mode for SOQL/SOSL/DML:** flipped from System Mode → **User Mode** for classes saved at v67+.
- **`WITH SECURITY_ENFORCED` fully removed** — code using it won't compile at v67+. Use `WITH USER_MODE` instead.
- **`WITH USER_MODE`** enforces FLS, CRUD, *and* sharing together, validates the full WHERE clause including polymorphic fields (`Owner`, `What.Name`), and reports **all** inaccessible fields in one exception via `e.getInaccessibleFields()`.
- **Triggers** always run in System Mode across all API versions and can no longer carry a sharing keyword — push sharing-sensitive logic into handler classes.
- Classes still pinned to API v66 or earlier keep the old behavior until recompiled at v67+.

## FLS/CRUD Enforcement

```apex
// Current best practice (v67+) — enforces FLS + CRUD + sharing in one clause
List<Contact> contacts = [SELECT Id, Name, Email FROM Contact WITH USER_MODE];

// Security.stripInaccessible — gentler alternative
// Silently removes inaccessible fields rather than throwing
SObjectAccessDecision decision = Security.stripInaccessible(
    AccessType.READABLE,
    [SELECT Id, Name, SSN__c FROM Contact]
);
List<Contact> safeContacts = (List<Contact>) decision.getRecords();
```

**Key difference:** `WITH USER_MODE` throws on violation (fail loud). `Security.stripInaccessible` silently strips (graceful degradation). Pick based on whether a partial result is acceptable.

## Quick reference — entry-point sharing defaults

| Entry point | Before v67 | v67+ |
|-------------|------------|------|
| Class with no keyword | `without sharing` | `with sharing` |
| `inherited sharing` class | `with sharing` | `with sharing` |
| Trigger (any version) | System mode, no keyword allowed | System mode, no keyword allowed |
