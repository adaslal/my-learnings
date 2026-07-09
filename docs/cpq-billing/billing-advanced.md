---
title: Billing — Invoice Lifecycle & Advanced
---

# Salesforce Billing — Invoice Lifecycle & Advanced

## Subscription vs one-time products

Only products with `SBQQ__SubscriptionType__c` set to `Renewable` or `Evergreen` generate `SBQQ__Subscription__c` records when a contract is activated. One-time products generate **Asset** records instead.

**Why it matters:** Subscriptions are what drive recurring billing via the Invoice Scheduler. If a product isn't set to Renewable/Evergreen, it won't recur.

## Invoice Scheduler

The configuration record that tells Billing:
- How often to bill (monthly, quarterly, annual)
- Which Billing Account to use
- Whether billing is in advance or in arrears

**Without an Invoice Scheduler, Bill Runs don't know when or how to generate invoices for a subscription.** Every subscription product needs one.

## Invoice lifecycle

```
Invoice (Draft)
  → Bill Run processes → Invoice (Posted)
  → Customer pays → Invoice (Paid)
```

| Status | Triggered by |
|--------|-------------|
| Draft | Invoice Scheduler creates invoice record |
| Posted | Bill Run processes the draft invoice |
| Paid | Payment record created and matched to invoice |

**Bill Now vs Scheduled Bill Run:**
- **Bill Now** — generates an immediate invoice for a specific subscription or order. Used for off-cycle billing, corrections, or one-off billing outside the normal cadence.
- **Scheduled Bill Run** — processes all eligible subscriptions in batch at a configured cadence (monthly, quarterly, annual). This is the normal production path.

## CPQ → Billing integration chain

The Contract drives Billing:

```
CPQ Contract activated
  → SBQQ__Subscription__c records created per product
  → Billing reads Subscriptions via Invoice Scheduler
  → Bill Runs generate Invoice Lines from Subscription data
```

**Danger:** Manually deleting Subscription records breaks the chain — Billing has nothing to invoice. Never delete Subscriptions; deactivate or cancel them through the proper CPQ process instead.

## Amendment impact on billing

When an amendment activates, Billing recalculates remaining invoices on existing subscriptions:
- If co-termed: a proration credit appears on the next invoice
- The Invoice Scheduler updates to reflect the new recurring amount going forward
- Already-posted invoices are not retroactively changed

**Co-terming:** when an amendment aligns end dates across all products on the contract so billing stays synchronized. Without co-terming, products on the same contract can have different end dates — billing becomes a scheduling nightmare.

## Revenue recognition in Billing

Separates **when revenue is recognized** from when cash is received.

A one-year subscription billed upfront: recognize 1/12 of revenue per month, not all at signing. Billing supports rev rec schedules linked to performance obligations.

**Three events (don't conflate them):**
1. **Billing** — when you invoice the customer
2. **Cash collection** — when payment lands in the bank
3. **Revenue recognition** — when you've earned the revenue (service delivered, per ASC 606)

These routinely happen on different dates, especially for annual-prepay subscriptions.

## Payment failure and dunning

When a payment fails, Billing triggers a configurable **dunning process**:
1. Retry payment N times at set intervals
2. Send reminder emails at each retry
3. Escalate to collections status if unresolved

Configure via Payment Gateway settings and Dunning Rules in Billing Setup.

## Key billing objects

| Object | Role |
|--------|------|
| `SBQQ__Subscription__c` | Recurring subscription generated from a Contract |
| `blng__Invoice__c` | Invoice sent to customer |
| `blng__InvoiceLine__c` | Line item on an Invoice |
| `blng__CreditNote__c` | Credit against an invoice (legacy naming; Revenue Cloud calls this Credit Memo) |
| `blng__CreditNoteAllocation__c` | Links a Credit Note Line to a specific Invoice Line |
| `blng__BillingAccount__c` | Who gets billed — may differ from Account |
| `blng__BillRun__c` | Batch run that generates invoices from eligible subscriptions |
| `blng__PaymentGateway__c` | Payment processor configuration |

## Multi-currency in CPQ + Billing

CPQ uses Salesforce standard multi-currency:
- Contracted Prices stored in the account's currency
- Pricing waterfall runs in the quote currency, converts at org exchange rate at time of quoting
- **Amendment orders must preserve the original contract currency** — currency change mid-contract causes inconsistent proration calculations

## SBQQ.ServiceRouter — CPQ's public API

CPQ's public Apex API for invoking managed package services from custom Apex code. Use when you need to trigger CPQ logic (contract creation, quote reading, pricing) from outside the managed package:

```apex
// Example: create a contract from Apex using ServiceRouter
Map<String,Object> inputMap = new Map<String,Object>{
    'quoteId' => quoteId
};
Map<String,Object> outputMap = new Map<String,Object>();
SBQQ.ServiceRouter.read('SBQQ.ContractReadService', JSON.serialize(inputMap));
```

This avoids directly manipulating CPQ's internal managed-package objects, which can break with package upgrades.
