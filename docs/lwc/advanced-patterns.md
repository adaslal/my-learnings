---
title: Advanced LWC Patterns
---

# Advanced LWC Patterns

## @wire vs Imperative — the most common interview opener

| Use @wire when | Use imperative when |
|----------------|---------------------|
| Read-only data that loads on component mount | User triggers the call (button click, form submit) |
| Caching is beneficial (same data used across components) | The call mutates data (DML) |
| Data automatically refreshes when reactive properties change | You need to control exactly when the call fires |
| `getRecord`, `getRelatedListRecords` | Any action that changes state |

**When NOT to use @wire:** if the query input changes dynamically based on user interaction (e.g., a picklist drives a second Apex query), use an imperative call. Wire re-fires when reactive props change, but you lose control over timing and can't show a proper spinner between user action and data arrival.

## @wire + refreshApex pattern

```javascript
import { LightningElement, wire } from 'lwc';
import getExpenses from '@salesforce/apex/ExpenseController.getExpenses';
import { refreshApex } from '@salesforce/apex';

export default class ExpenseDashboard extends LightningElement {
    wiredExpensesResult; // store the wire result for refreshApex

    @wire(getExpenses)
    wiredExpenses(result) {
        this.wiredExpensesResult = result;  // capture for refresh
    }

    // Call after a mutation to force the wire to re-fetch
    async syncFromExternal() {
        await syncExpenses();  // imperative DML call
        await refreshApex(this.wiredExpensesResult);  // invalidates cache, triggers re-fetch
    }
}
```

---

## Server-side pagination with lightning-datatable

Never load 10,000 records at once. Use OFFSET + LIMIT server-side.

```apex
@AuraEnabled(cacheable=true)
public static List<Account> getPage(Integer pageSize, Integer pageNumber) {
    Integer offset = (pageNumber - 1) * pageSize;
    return [SELECT Id, Name, Phone FROM Account ORDER BY Name LIMIT :pageSize OFFSET :offset];
}
```

**OFFSET limit:** OFFSET has a hard limit of 2,000. For truly large datasets (>2,000 records), use cursor-based pagination — store the last record's Id or sort field value and use `WHERE Id > :lastId ORDER BY Id LIMIT :pageSize` instead of OFFSET.

```javascript
// LWC controller
@track currentPage = 1;
@track pageSize = 20;

handleNext() {
    this.currentPage += 1;
    this.loadPage();
}
loadPage() {
    getPage({ pageSize: this.pageSize, pageNumber: this.currentPage })
        .then(data => this.records = data);
}
```

---

## Lightning Message Service (LMS) — cross-DOM communication

LMS is for communication between components with **no common parent**: components on different tabs, standard and custom components on the same record page, components in different regions.

```javascript
// messageChannel/AccountSelectedChannel.messageChannel-meta.xml must exist

// Publisher component
import { publish, MessageContext } from 'lightning/messageService';
import ACCOUNT_SELECTED from '@salesforce/messageChannel/AccountSelectedChannel__c';

export default class AccountList extends LightningElement {
    @wire(MessageContext) messageContext;

    handleRowSelect(event) {
        publish(this.messageContext, ACCOUNT_SELECTED, {
            accountId: event.detail.selectedRows[0].Id
        });
    }
}

// Subscriber component (can be anywhere on the same app page)
import { subscribe, MessageContext } from 'lightning/messageService';
import ACCOUNT_SELECTED from '@salesforce/messageChannel/AccountSelectedChannel__c';

export default class AccountDetail extends LightningElement {
    @wire(MessageContext) messageContext;
    subscription = null;

    connectedCallback() {
        this.subscription = subscribe(this.messageContext, ACCOUNT_SELECTED, (msg) => {
            this.accountId = msg.accountId;
        });
    }

    disconnectedCallback() {
        // Always unsubscribe to prevent memory leaks
        if (this.subscription) unsubscribe(this.subscription);
    }
}
```

**LMS vs CustomEvent:** CustomEvent goes parent→child or child→parent. LMS goes across any boundary — different tabs, different DOM regions.

---

## LWC lifecycle hooks

| Hook | When it fires | Use for |
|------|--------------|---------|
| `constructor()` | Component instance created | Initialize properties. Cannot access DOM yet. |
| `connectedCallback()` | Component inserted into DOM | Start subscriptions (LMS), load initial data, event listeners |
| `renderedCallback()` | Runs after every render | Third-party library init (runs after DOM is ready). Use sparingly — avoid setting reactive properties here (causes infinite render loops) |
| `disconnectedCallback()` | Component removed from DOM | Clean up subscriptions, remove event listeners |
| `errorCallback(error, stack)` | Error in a child component | Graceful error boundary for child errors |

---

## Shadow DOM — the one rule

LWC enforces Shadow DOM per component. A parent **cannot** `querySelector` into a child's DOM tree.

```javascript
// Works — within THIS component's template
const button = this.template.querySelector('lightning-button');

// FAILS — trying to reach inside a child component's shadow root
const childInput = this.template.querySelector('c-child-component input');  // null

// Correct approach — use @api on the child to expose what you need
```

**Why this matters:** every component owns its own DOM subtree. Cross-component DOM manipulation is blocked by design. Use `@api` properties, `CustomEvent`, or LMS to communicate across component boundaries.

---

## EmpApi — real-time Platform Event subscription in LWC

Subscribe to Platform Events directly in LWC for real-time UI updates without polling.

```javascript
import { subscribe, onError } from 'lightning/empApi';

connectedCallback() {
    const channel = '/event/Order_Created__e';
    subscribe(channel, -1, (event) => {
        // fires every time an Order_Created__e is published
        this.orders = [...this.orders, event.data.payload];
    });
    onError((error) => console.error('EmpApi error', error));
}
```

**Why not `setInterval` polling?** Polling burns API calls and delays updates by the poll interval. EmpApi gets the event within seconds of publishing, uses CometD under the hood, and has no polling overhead.

---

## Lightning Web Security (LWS) — replacing Locker Service

LWS is stricter than Locker Service:
- No cross-component DOM access (enforced at platform level)
- No `eval()`
- Restricted browser global APIs

**If you hit a LWS restriction:** refactor to pass data via `@api` properties or LMS rather than direct DOM manipulation — that's the correct LWC pattern anyway, and it makes the component testable.

---

## LDS auto-refresh — the Stage Tracker interview question

Lightning Data Service (LDS) is a shared client-side cache across the **entire Lightning record page**. When any component saves the record, LDS invalidates its cache and **pushes updated data to every `@wire(getRecord)` subscriber** on the page automatically.

This is why a Stage Tracker component that uses `@wire(getRecord)` updates itself when a Stage picklist component on the same page saves — no pub/sub, no LMS, no manual refresh needed. LDS handles it.
