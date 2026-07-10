---
title: PSA / Certinia Overview
---

# PSA / Certinia Overview

Certinia (formerly FinancialForce) PSA is a project management and professional services automation app built natively on Salesforce. Unlike third-party PSA tools, it shares the same org, objects, and data model as your CRM — no middleware needed to connect Opportunities to Projects.

## Key objects

| Object | What it represents |
|--------|-------------------|
| `pse__Proj__c` | Project — the top-level delivery container |
| `pse__Resource__c` | A person who can be assigned to projects (usually a Contact) |
| `pse__Assignment__c` | A specific resource assigned to a project phase (enables timecard entry) |
| `pse__Timecard_Header__c` | Week-level timecard container |
| `pse__Timecard__c` | Day-level time entry (one per day/project/assignment) |
| `pse__Expense__c` | Expense claim linked to a project |
| `pse__Milestone__c` | A delivery milestone — triggers Fixed Fee billing events |
| `pse__Billing_Event__c` | Triggers invoice generation |
| `pse__Permission_Control__c` | Junction record — grants a resource ability to log time for a Region + Practice |
| `pse__Rate_Card__c` | Container for bill rates and cost rates by role |
| `pse__Schedule__c` | Defines working hours / available hours for a resource |

## The full lifecycle

```
Opportunity
  → Services Estimator (estimate, approval)
  → PSA Project (phases, milestones, resource assignments)
  → Timecards submitted + approved
  → Billing Events generated (T&M auto, Fixed Fee manual/milestone)
  → Invoice
  → FM Cloud (revenue recognition, GL journal entries)
```

## Permission Control — the #1 access issue

`pse__Permission_Control__c` is a junction record that grants a specific Resource the ability to submit timecards and expenses for a **Region + Practice** combination. Without it, the resource cannot enter time on any project in that region/practice — the timecard entry simply doesn't appear.

This is the first thing to check when a resource says "I can't log time."

## External training resources

- **[PSA End User Training — Certinia Training Center](https://certinia.my.site.com/trainingcenter/s/psa-end-user-training)** — Certinia's official end-user training portal. Covers timecards, expense submission, project views, and resource management from the end-user perspective. Good before any PSA go-live or onboarding project.

- **[Services Estimator — Strategic Advantage for Estimates (AblyrPro)](https://ablypro.com/certinia-services-estimator-your-strategic-advantage-for-accurate-estimates-and-smooth-project-delivery)** — In-depth walkthrough of Services Estimator's value proposition, data structure, and how it connects pre-sales to project delivery.

- **[Services Estimator Video Demo (LinkedIn — Illustre Software)](https://www.linkedin.com/posts/illustre-software_salesforce-certinia-serviceestimator-activity-7445556155361406976-oNb0/)** — Visual walkthrough of Services Estimator in action. Watch for the Estimate → Push to Opportunity → Create Project flow.
