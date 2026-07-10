---
title: Services Estimator
---

# Services Estimator (formerly Services CPQ)

## What it is

Services Estimator lets Sales build a detailed project estimate on an Opportunity — phases, tasks, resource roles, rates — get it approved, then convert it directly into a PSA project. It eliminates the spreadsheet-to-PSA re-entry gap.

**Namespace:** `ffscpq__`  
**Package:** Separate managed package on top of PSA + Foundations

**One-liner for interviews:** "Services Estimator lets Sales build a detailed project estimate on the Opportunity — phases, tasks, resource roles, rates — get it approved, then convert it directly into a PSA project. It eliminates the spreadsheet-to-PSA re-entry gap."

## Data structure

```
Opportunity
  └── Estimate (ffscpq__Estimate__c)
        └── Estimate Products (ffscpq__Estimate_Product__c)
              └── Line Sets (ffscpq__Line_Set__c)
                    └── Tasks (ffscpq__Task__c)
                          └── Role Requests (ffscpq__Role_Request__c)
```

## Estimate lifecycle

```
Draft → Submitted → Approved (or Rejected → Draft)
```

## Key actions on an Estimate

### Push to Opportunity
Creates Resource Requests + Opportunity Products on the Opportunity.
- Gives Sales visibility into resource demand for forecasting
- Doesn't create a project yet — just surfaces the demand signal

### Create Project from Estimate
Converts an Approved estimate into a PSA Project:
- Phases / tasks / role requests carry over
- Budget pre-populated from estimate
- Can create multiple projects per estimate (one per Estimate Product)
- Triggers `ffscpq__ServicesEstimatorPlatformEvent__e` for async downstream automation

## Pricing methods

| Method | How it works |
|--------|-------------|
| T&M | Hours × Rate from Rate Card |
| Cost Plus | Cost + Markup % |

Both enabled via Feature Console in PSA setup.

## Rate application in SE

Role Requests pull rates from PSA Rate Cards. For complex rate matching (territory-specific, dated, account-specific rates), implement the **Custom Rate Card Matcher Plugin:**

```apex
global class CustomRateCardMatcher implements pse.RateCardMatcherPlugin.IFinalRateCardChoicePlugin {
    global pse__Rate_Card__c selectRateCard(
        pse.RateCardMatcherPlugin.RateCardChoice choice
    ) {
        // Custom logic to pick the right rate card
        // e.g., match on Account region, practice, date
        return choice.defaultRateCard;
    }
}
```

## SE + Salesforce CPQ integration

SE–CPQ Connector package allows:
- Push SE estimate to a CPQ Quote
- Create a Quote from an estimate
- Create an estimate from a CPQ Quote

Used when selling a **product + services bundle** — CPQ handles the product pricing, SE handles the services/resource estimate, connector keeps them in sync.

## Output Builder

Generates estimate documents (PDFs, Word). Enabled via Feature Console, requires the Output Builder package installed separately.

## SE Platform Events

`ffscpq__ServicesEstimatorPlatformEvent__e` — fired on async operations (estimate-to-project conversion, push to opportunity). Subscribe via a trigger or Flow to automate downstream processes when the conversion completes.

## Interview Q&A

**Q: What's the difference between a Resource Request and an Assignment in the context of Services Estimator?**
> In SE, Role Requests define the staffing demand ("I need a Senior Developer for 160 hours"). When you "Create Project from Estimate," those Role Requests become PSA Resource Requests. The Resource Manager then fulfills those Requests by creating Assignments — linking a specific named person to a project phase. The Assignment enables timecard entry.

**Q: What happens if you change an estimate after it's been pushed to the Opportunity?**
> You need to re-push to Opportunity to update the Resource Requests and Opportunity Products. Changes to an already-converted project do NOT automatically flow back to the estimate or vice versa — the two are decoupled once "Create Project from Estimate" runs. This is a common gap to flag to clients: SE is the source during pre-sales; PSA is the source of truth post-delivery.

**Q: Can you have multiple projects from one estimate?**
> Yes — one PSA project is created per Estimate Product. If the estimate has two products (e.g., "Phase 1 Implementation" and "Training"), you get two separate PSA projects from a single estimate approval.

## References

- [Services Estimator — Your Strategic Advantage (AblyrPro)](https://ablypro.com/certinia-services-estimator-your-strategic-advantage-for-accurate-estimates-and-smooth-project-delivery) — in-depth breakdown of SE's data structure, workflow, and value proposition
- [Services Estimator Video Demo (LinkedIn — Illustre Software)](https://www.linkedin.com/posts/illustre-software_salesforce-certinia-serviceestimator-activity-7445556155361406976-oNb0/) — visual walkthrough of the full Estimate → Push to Opportunity → Create Project flow
