---
title: Revenue Cloud vs CPQ
---

# Revenue Cloud — New Platform vs Legacy CPQ

## The most important distinction to get right

There are two products called "Revenue Cloud" in the wild. Conflating them in an interview signals you don't know the space.

| | Salesforce CPQ (legacy) | Revenue Cloud / RLM |
|---|---|---|
| Also called | Salesforce CPQ, SBQQ | Revenue Lifecycle Management, Agentforce Revenue Management |
| Architecture | Managed package (`SBQQ__` namespace) bolted onto Sales Cloud | Native, platform-built (Einstein 1 Platform), API-first |
| Status (2026) | **End-of-Sale** — no new customers, existing customers keep support | Actively developed current product |
| Core objects | `SBQQ__Quote__c`, `SBQQ__QuoteLine__c`, Product Rules, Price Rules | Standard: Quote, Order, Contract, Invoice, Asset, ProductSellingModel |
| Scope | Quoting only | Full quote-to-cash: Catalog → CPQ → Order Mgmt → Billing → Revenue Recognition |

**Interview framing:** If you've worked hands-on with Salesforce CPQ (not native Revenue Cloud), lead with that exactly — it's a bridge, not a liability. "I've worked hands-on with Salesforce CPQ — pricing rules, discount schedules, approval flows — so the quote-to-cash domain is very familiar. Revenue Cloud is the same lifecycle on a different object model. I can map what I know onto it quickly."

## Revenue Cloud backbone

```
Quote → Order → Contract → Invoice → Asset
```

The same lifecycle as CPQ's Quote → Order → Contract, just on native platform objects instead of SBQQ managed-package objects.

## Key standard objects

| Object | What it represents |
|--------|-------------------|
| `Quote` | Customer-facing proposal — products, pricing, terms |
| `Order` | Confirmed commitment; drives fulfillment and billing |
| `Contract` | Long-term agreement generated from an Order |
| `Invoice` | Billing schedule output — periods, due dates, amounts |
| `Asset` | Active subscription/product the customer owns |
| `ProductSellingModel` | How a product is sold: One-Time, Evergreen, or Term Defined |
| `Product2` | Base product record (same as core Salesforce, extended) |
| `QuoteLineItem` / `OrderItem` | Line items carrying product, quantity, pricing |
| `QuoteLineDetail` / `OrderItemDetail` | Granular config, discounts, rate plan details below line level |

## ProductSellingModel — why it matters

A single `Product2` can have multiple selling models attached:

- **One-Time** — purchased once, no recurring billing
- **Evergreen** — ongoing subscription with no fixed end date
- **Term Defined** — subscription with a set duration (e.g., 12-month contract)

This drives billing frequency, renewal behavior, and revenue recognition rules. Same product (e.g., a router) sold as one-time or as part of a 24-month contract uses the same `Product2` — different `ProductSellingModel`.

## Billing-side objects

| Object | Role |
|--------|------|
| Invoice | What gets sent to the customer |
| Credit Memo | Adjusts an invoice downward (returns, overcharges) |
| Debit Memo | Adjusts an invoice upward (undercharges, added charges) |
| Payment | Records money actually received |

**Legacy Salesforce Billing naming:** Credit Note / Debit Note → renamed Credit Memo / Debit Memo in Revenue Cloud. Same concept, different names.

## Your CPQ experience mapped to Revenue Cloud

| CPQ (what you've done) | Revenue Cloud equivalent |
|------------------------|-------------------------|
| `SBQQ__Quote__c` | `Quote` |
| `SBQQ__Order__c` | `Order` |
| `Contract` | `Contract` |
| CPQ Billing Invoice | `Invoice` |
| Credit Note / Credit Note Line / Credit Note Allocation | Credit Memo |
| Usage Tracker / Usage Summary | Usage-based billing objects on native platform |

## Your actual CPQ workflow (use this, not a generic answer)

1. New Quote on Opportunity → add bundle products, configure options, recalculate
2. Mark Quote **Primary = true** → syncs Quote Lines to Opportunity as OLIs
3. Set Opportunity **Closed Won**, then **Ordered = true** on Primary Quote → generates Order; **Contracted = true** on that Order → generates Contract
4. **Amendment:** Click Amend on Contract → Amendment Opportunity → new Amendment Quote → Closed Won → Amendment Order
5. **Renewal:** Check **Renewal Forecast** on Contract → creates Renewal Opportunity with temp quote records. Check **Renewal Quoted** → adds a real, persistent Primary Quote. Nuance: after Renewal Quoted is checked, later contract amendments don't auto-update the Renewal Quote — must uncheck then recheck to force a re-quote

## Revenue Recognition — three separate events

These three routinely happen on different schedules — the whole point of revenue recognition as a discipline:

- **Billing** — when you invoice the customer
- **Cash collection** — when money lands in the bank (governed by payment terms: Net 30, etc.)
- **Revenue Recognition** — when ASC 606 / IFRS 15 let you record it as earned (tied to service delivery)

**Classic example:** Customer pays $1,200 upfront for a 12-month subscription. Billing and cash both happen day 1. Revenue recognition spreads $100/month — that $1,200 sits as **deferred/unearned revenue** on the balance sheet until earned.

**Early termination:** depends on the contract clause, not a fixed accounting rule.
- Pro-rata refund clause → unearned portion is a **refund liability** until refunded. Credit Memo executes the credit.
- Non-refundable → no further obligation on either side → remaining deferred revenue recognized immediately.

## Product catalog concepts

- **Product** — what you sell. A "Component" product is only sellable inside a bundle, not standalone
- **Price Book** — pricing for products; multiple price books per customer segment/region
- **Bundle** — parent product made of component products (e.g., Fiber + Router + Installation)
- **Quote** — customer-facing proposal with products, pricing, terms
- **Order** — confirmed commitment that Finance/Ops use to fulfill and invoice
