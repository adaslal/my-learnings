---
title: New Revenue Cloud (RLM) Architecture
---

# New Revenue Cloud — RLM Architecture

Salesforce has two products both called "Revenue Cloud" in the wild. Conflating them in an interview sounds like you don't know the space. This page is the disambiguation.

## Legacy CPQ vs New Revenue Cloud

| | Salesforce CPQ (legacy) | Revenue Cloud / RLM (current) |
|---|---|---|
| **Also called** | CPQ, Salesforce CPQ, `SBQQ` package | Revenue Cloud, Revenue Lifecycle Management (RLM), Agentforce Revenue Management |
| **Architecture** | Managed package (`SBQQ` namespace) bolted onto Sales Cloud | Native, platform-built (Einstein 1 Platform), API-first |
| **Status in 2026** | **End-of-Sale** — no new customers, no new features, support/renewals continue | Actively developed, current product |
| **Primary objects** | `SBQQ__Quote__c`, `SBQQ__QuoteLine__c`, Product Rules, Price Rules, Custom Metadata | Standard platform objects: Quote, Order, Contract, Invoice, Asset, ProductSellingModel |
| **Covers** | Quoting phase only | Full quote-to-cash: Product Catalog → CPQ → Order Mgmt → Billing → Revenue Recognition |

**Interview framing:** "Legacy CPQ covers the deal-structuring phase. New Revenue Cloud is a full platform rebuild — different objects, different architecture — designed as CPQ's long-term successor. Since Salesforce stopped selling legacy CPQ, any new implementations use Revenue Cloud, but a lot of existing clients are still on legacy CPQ since migration isn't mandatory."

## New Revenue Cloud — the backbone

```
Quote → Order → Contract → Invoice → Asset
```

A commercial offer (Quote) becomes a confirmed Order, which may produce a Contract, generates Invoices, and creates/updates Assets the customer owns (active subscriptions/entitlements).

### Core standard objects

| Object | Role |
|--------|------|
| **Quote** | Commercial offer — items, pricing, discounts |
| **QuoteLineItem** | One line on the quote: product, quantity, price |
| **Order** | Confirmed commitment (created when Quote is accepted) |
| **OrderItem** | Line item on the Order |
| **Contract** | Legal agreement, drives subscription term + renewal |
| **Invoice** | Billing output — amounts due, payment schedule |
| **Credit Memo** | Adjusts an invoice downward (returns, overcharges) |
| **Debit Memo** | Adjusts an invoice upward (undercharges, added charges) |
| **Payment** | Records money actually received |
| **Asset** | A product the customer currently owns/has active |

### ProductSellingModel — how a product can be sold

A single `Product2` record can have multiple Selling Models attached, each defining a different commercial arrangement:

| Type | Meaning | Example |
|------|---------|---------|
| **One-Time** | Single payment, no recurring | Setup fee, hardware |
| **Term Defined** | Subscription with a fixed end date | 12-month SaaS contract |
| **Evergreen** | Ongoing subscription with no fixed end | Month-to-month plan |

The same software product could be listed with a One-Time model (perpetual license) and a Term Defined model (annual subscription) — the customer picks which at quote time.

### Line-level objects

| Object | Carries |
|--------|---------|
| `QuoteLineItem` / `OrderItem` | Product, quantity, list price, discount |
| `QuoteLineDetail` / `OrderItemDetail` | Product configuration, rate plan details, more granular than the line item |
| `ProductSellingModel` | Which commercial model applies to this line |

## Your CPQ experience mapped to RLM

If asked "how does your CPQ background relate to Revenue Cloud?" — use this bridge:

| Legacy CPQ / Billing | New Revenue Cloud equivalent |
|----------------------|------------------------------|
| `SBQQ__Quote__c` | `Quote` (standard object) |
| `SBQQ__QuoteLine__c` | `QuoteLineItem` |
| CPQ Billing Invoice | `Invoice` |
| Credit Note | `Credit Memo` |
| Usage Tracker / Usage Summary | Usage-based billing native objects |

**One-liner:** "Same lifecycle — Quote → Order → Contract → Invoice — but RLM runs on native platform objects instead of the `SBQQ` managed-package objects. The commercial concepts are identical; the implementation layer is what changed."

## Billing object detail (your real CPQ + Billing experience)

From actual hands-on work with the legacy Billing package:

**Order → Invoice:** Once an Order is placed, CPQ Billing generates Invoice records related to each Order Product. Each Invoice has related Invoice Lines.

**Credit/Debit adjustments:** A Credit Note (legacy Billing term — RLM renamed this Credit Memo) holds Credit Note Lines, which are *allocated* against specific Invoice Lines. The join record is a **Credit Note Allocation** — not a direct lookup from Invoice Line to Credit Note.

**Amendment workflow:**
1. Click **Amend** on a Contract → creates Amendment Opportunity
2. New Amendment Quote on it → configure changed products
3. Closed Won → Amendment Order (handles deltas, not full re-pricing)

**Renewal workflow:**
1. **Renewal Forecast** on Contract → creates Renewal Opportunity (with temp quotes for price calc)
2. **Renewal Quoted** → adds a real, persistent Primary Quote to the Renewal Opportunity
3. Key nuance: once Renewal Quoted is checked, later amendments to the original contract don't auto-update the Renewal Quote — you must uncheck then recheck Renewal Quoted to force a re-quote

## Process Builder → Flow (current status)

Relevant for any Revenue Cloud / declarative automation conversation:

- **Process Builder:** end of support December 31, 2025 — no new bug fixes, no new features. Existing processes keep running, but Salesforce won't support them.
- **Workflow Rules:** same end-of-support date, same status.
- **Flow Builder:** the only actively supported declarative automation tool. Use for all new automation; migrate existing Process Builder/Workflow processes using Salesforce's **Migrate to Flow** tooling.

If asked about Process Builder in an interview context: "Process Builder is past end-of-support as of end of 2025. For anything new, it's Flow Builder — and for an org with existing Process Builder processes, the first assessment would be which ones to migrate using the Migrate to Flow tool."
