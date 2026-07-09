---
title: Design Decision Matrices
---

# Design Decision Matrices

## Flow vs Apex — when to use which

**Default to Flow first.** Apex when Flow becomes unmaintainable or can't do the job.

| Use Flow when | Use Apex when |
|---------------|---------------|
| Straightforward record-level automation (field updates, create/update related records) | Complex business logic requiring loops, collections, or conditional branches across multiple objects |
| User-facing guided processes (screen flows) | HTTP callouts to external systems |
| Approval process orchestration | Operations requiring precise transaction control (savepoints, rollbacks) |
| Email alerts and simple notifications | Bulk-safe processing of 10,000+ records |
| Admin can maintain it without a developer | Recursion control, retry logic, exponential back-off |
| After-save record automation with simple conditions | Custom authentication, token management |

**Hybrid pattern:** Flow handles the declarative trigger ("when this record changes"), calls an Apex Action for the complex logic, Apex Action enqueues a Queueable. You get the declarative entry point without sacrificing code quality.

---

## Custom Metadata vs Custom Settings vs Custom Labels

| | Custom Metadata Types | Custom Settings (Hierarchy) | Custom Labels |
|--|----------------------|-----------------------------|---------------|
| **What it stores** | Structured records with multiple fields | Name-value pairs (with optional user/profile override) | Single text strings |
| **Access in Apex** | `MyMdt__mdt.getInstance('Name').Field__c` — no SOQL needed (cached) | `MySettings__c.getInstance()` — no SOQL | `Label.My_Label_Name` |
| **Deployable** | Yes — via Metadata API, packages | No — values not deployed | Yes — via Metadata API |
| **Per-user values** | No | Yes (Hierarchy type: Org → Profile → User) | No |
| **Visible to admins** | Yes — in Setup | Yes — in Setup | Yes — in Setup |
| **Survives sandbox refresh** | Yes | No (usually cleared) | Yes |
| **Use for** | Integration config (client IDs, endpoint paths, feature flags), app settings that need to deploy | User preferences, runtime tokens, per-user state | UI text, translatable strings, field labels |

### Decision rule

- **OAuth config (Client ID, Redirect URI, endpoint base URL)** → Custom Metadata. Deployable, cached, no SOQL.
- **OAuth tokens (access_token, refresh_token, expiry)** → Custom Settings. Runtime-modifiable, per-user.
- **UI strings, button labels, error messages** → Custom Labels. Translatable.
- **Feature flags that need to deploy** → Custom Metadata.
- **User-specific preferences** → Custom Settings (Hierarchy type, User level).

---

## Lookup vs Master-Detail

| | Master-Detail | Lookup |
|--|---------------|--------|
| Required on child | Yes — child can't exist without parent | No — parent is optional |
| Cascade delete | Yes — deleting parent deletes all children | No — parent deletion leaves orphan records |
| Roll-up summary fields | Yes — SUM, COUNT, MIN, MAX on children | No — requires trigger or flow |
| OWD sharing inheritance | Yes — child inherits parent's OWD | No — child has its own OWD |
| Reparenting | Not allowed (parent locked once set) | Yes — you can change the parent |
| Ownership | Child inherits owner from parent | Child has its own owner |

**Use Master-Detail when:** the child record has no meaning without the parent (Invoice Line → Invoice, Quote Line → Quote). The tight coupling is intentional.

**Use Lookup when:** the relationship is optional or the child might exist independently (Contact → Account — a Contact can exist without an Account). Also when you need to reparent, or when the child's sharing should be independent of the parent.

---

## Queueable vs Batch vs @future

| | @future | Queueable | Batch Apex |
|--|---------|-----------|-----------|
| Complex object params | No (primitives only) | Yes | Via constructor |
| Chaining | No | Yes (1 child per execute) | No |
| Monitoring (Apex Jobs) | Limited | Yes | Yes |
| Callouts allowed | With `(callout=true)` | With `Database.AllowsCallouts` | With `Database.AllowsCallouts` |
| Data volume | Single/small | Small to medium | Any (up to 50M rows) |
| Use when | Simple fire-and-forget callout | Retry logic, chaining, complex params | 10,000+ records, nightly sync |

**Production constraint:** Queueable's `execute()` can only call `System.enqueueJob()` once — one child chain per execution. Multiple `enqueueJob()` calls in the same execute throw `AsyncException`. For true parallel fan-out, use Batch Apex.

---

## Named Credential vs Remote Site Setting vs Hardcoded URL

| | Named Credential | Remote Site Setting | Hardcoded in Apex |
|--|-----------------|--------------------|--------------------|
| Stores URL | Yes | Yes (allowlist only) | Yes |
| Stores credentials | Yes | No | Never do this |
| Deployable | Yes (structure, not secrets) | Yes | N/A (it's code) |
| Changes without code deploy | Yes (update in Setup) | Yes | No |
| Use | All external callouts | ONLY when managing auth in Apex yourself (e.g., Bearer token in header) | Never |

**One-sentence Named Credential answer for interviews:** "Credentials never live in code, Salesforce handles authentication, and the endpoint is configurable per environment without a code change."

**Named Credentials and deployment — critical nuance:** The structure deploys via Metadata API. The **secrets do not** — after deployment to a target org, someone must manually enter credentials in Setup → Named Credentials before callouts work.
