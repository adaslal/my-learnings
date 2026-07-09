# Salesforce Billing Object Model

Legacy managed package (SBQQ namespace). Distinct from native Revenue Cloud.

## Object hierarchy

Order → **Invoice** (one per Order Product) → **Invoice Lines** → **Credit Notes** (via Credit Note Lines + Credit Note Allocation records)

## Key distinctions
- **Billing** = invoicing the customer (charging)
- **Cash collection** = money actually received (governed by payment terms, e.g. Net 30)
- **Revenue Recognition** = when revenue is recorded as earned (ASC 606 / IFRS 15 — tied to service delivery)

These are three separate events. A customer can pay upfront (cash collected), be invoiced monthly (billing), while revenue is recognised monthly as service is delivered.

## Deferred revenue

,200 billed and collected upfront for a 12-month subscription → recognise 00/month as service is delivered. The unrecognised ,100 sits as **deferred/unearned revenue** on the balance sheet, not the income statement.

## Termination / refund
- Contract has refund clause → refund owed for undelivered months; issue Credit Note / Credit Memo
- Non-refundable on termination → remaining deferred revenue typically recognised immediately at termination