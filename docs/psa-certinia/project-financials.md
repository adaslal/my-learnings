---
title: Project Financials & Utilization
---

# Project Financials & Utilization

## Project Financials — the P&L view

Three numbers tracked at project level:

| | What it is | Source |
|--|-----------|--------|
| **Budget** | Planned hours × rate from estimate | Set at project/phase creation |
| **Actuals** | Approved timecard hours × rate | Timecards + Rate Cards |
| **Forecast (EAC)** | Actuals + Estimate to Complete (ETC) | Resource assignments going forward |

**Project P&L = Revenue (billed) − Cost (resource hours × cost rate) = Margin**

Visible in **Project Financial Summary** — real-time budget vs actuals vs forecast for hours, cost, revenue, and margin.

**One-liner for interviews:** "Project financials gives you real-time P&L — budget vs actuals vs forecast. PSA rolls it into the Project Financial Summary so you have full profitability visibility without leaving Salesforce."

## Resource Financials — margin at assignment level

Two rates per assignment drive profitability:

- **Bill Rate** — what the client pays per hour for this resource (from Rate Card, by Role + Region)
- **Cost Rate** — what the resource costs the company per hour (loaded cost)
- **Margin per resource** = (Bill Rate − Cost Rate) × Billable Hours

Rates live on the **Assignment** record. Rate Cards define defaults; you can override per assignment for specific deals.

## Utilization

### Two types

| | Scheduled Utilization | Actual Utilization |
|--|----------------------|-------------------|
| **Formula** | Assigned Hours / Available Hours × 100 | Approved Billable Timecard Hours / Available Hours × 100 |
| **Source** | Assignments (Work Planner) | Approved timecards |
| **View** | Forward-looking ("planned busyness") | Backward-looking ("real busyness") |
| **Used for** | Capacity planning, resource allocation | Profitability reporting, performance review |

**Available Hours** = Work Schedule hours − Schedule Exceptions (holidays, PTO, training).  
Driven by `pse__Schedule__c` on the resource and `pse__Schedule_Exception__c` records.

### Where utilization is tracked

- **Work Planner** — color-coded grid (Green = within target, Red = overallocated) per resource per week/month
- **Resource Utilization Report** — org-wide view across all resources
- **CRM Analytics / Einstein Analytics** — trend analysis, utilization vs target over time

### The gap that matters in real implementations

Scheduled utilization can look healthy (lots of assignments) but **actual utilization suffers** when:
- Timecards aren't submitted on time
- Hours are logged as non-billable (the resource is busy but the project doesn't capture revenue)
- Timecard splits show more non-billable than expected

The delta between scheduled and actual is where margin leaks. A PSA Lead monitors this delta actively — not just whether people are assigned, but whether those assignments translate to billed hours.

## PSA full lifecycle

```
Opportunity
  → Services Estimator (estimate phases, tasks, role requests, rates)
  → PSA Project (from estimate: phases, milestones, assignments)
  → Resource Assignments (Work Planner)
  → Timecards submitted → approved
  → Billing Events (T&M: auto-generated from timecards; Fixed Fee: manual or milestone-triggered)
  → Invoice
  → FM Cloud (revenue recognition, journal entries, GL)
```

## Key objects for financials

| Object | Purpose |
|--------|---------|
| `pse__Proj__c` | Project record — budget, EAC, financials |
| `pse__Assignment__c` | Resource assignment — bill rate, cost rate, hours |
| `pse__Timecard_Header__c` | Week-level timecard container |
| `pse__Timecard__c` | Day-level timecard entry (one per day/project/assignment) |
| `pse__Billing_Event__c` | Triggers invoice generation |
| `pse__Rate_Card__c` | Container for bill/cost rates |
| `pse__Rate__c` | One rate line (role + dates + rates) |
| `pse__Rev_Rec_Schedule__c` | Revenue recognition schedule for the project |

## Interview Q&A

**Q: A project is showing zero revenue despite lots of timecards. What do you check?**
> First: Are there Billing Events? Timecards don't generate revenue directly — they feed Billing Events, which generate invoices. If Billing Events haven't been created or triggered, revenue is zero even with 1,000 hours logged. Second: Are the timecards Approved (not just Submitted)? Only Approved timecards flow into financials. Third: Is there a Rate Card Line for the timecard date and resource role? No rate = $0 billing amount.

**Q: What's the difference between a Billing Event and an Invoice?**
> A Billing Event is the PSA object that represents "something billable happened" — approved timecard hours on a T&M project, a milestone reached on a Fixed Fee project. The Invoice is the client-facing document generated from Billing Events. Multiple Billing Events can roll up into one Invoice. Billing Events are how PSA's delivery side talks to the finance side.

**Q: How do you prevent margin leakage from a Resource Manager's perspective?**
> Three levers: First, ensure all assignments have rates (empty rate = $0 billing). Second, monitor scheduled vs actual utilization weekly — a resource who's assigned 40 hours but only submitting 30 approved billable hours is a 25% margin leak. Third, review timecard splits — resources logging non-billable time on billable projects is a training or process issue. PSA's Work Planner makes this visible if you look.
