---
title: OmniStudio & Industries Clouds
---

# OmniStudio & Salesforce Industries Clouds

## What "Salesforce Industries" means

Salesforce acquired Vlocity in 2020 — industry-specific data models and tools built on top of core Salesforce, now branded "Salesforce Industries." Includes Communications Cloud, Media Cloud, Health Cloud, Financial Services Cloud, and more.

**OmniStudio** is the underlying declarative toolset shared across all Industries Clouds.

## OmniStudio building blocks

| Tool | Purpose |
|------|---------|
| **OmniScript** | Click-configured, guided multi-step business processes. E.g., a "upgrade my plan" flow a customer walks through. No code — drag-and-drop steps. |
| **DataRaptor** | Reads/writes/transforms data for OmniScripts and Integration Procedures. Declarative mapping between Salesforce objects (or external data) and JSON without Apex. |
| **Integration Procedure** | Server-side orchestration — chains DataRaptors and external callouts together. Like a lightweight Apex service class but built declaratively. |
| **FlexCard** | Reusable, configurable UI component for displaying data — smarter, declarative version of an LWC card. |

**How they work together:** OmniScript (the guided UI) → calls Integration Procedures (server-side logic) → which use DataRaptors (data mapping) → results surface in FlexCards (display).

## Communications Cloud — relevant for telecom (BCE/Bell)

Built on OmniStudio, adds telecom-specific:

- **Enterprise Product Catalog** — handles complex telecom bundles: plans, add-ons, devices, promotions, contract terms
- **Industries CPQ** — telecom-specific quoting (SIM/device bundling, plan changes, term discounts)
- **Order Management** for telecom lifecycle events: new connection, plan change, suspend/resume, port-in/port-out

This is the tool behind Bell Canada's kind of business: mobility plans, internet bundles, TV packages.

## Media Cloud — don't overlook for Bell

Bell isn't only a connectivity company — **Bell Media** (CTV, TSN, Crave, iHeartRadio) is a real content and entertainment arm. Salesforce Media Cloud runs on the same OmniStudio toolkit but targets broadcasters/streamers:

- Ad sales management
- Subscription management
- Audience and rights management

OmniScript/DataRaptor/Integration Procedure/FlexCard skills transfer between Communications Cloud and Media Cloud — just different industry data models underneath.

## OmniStudio vs Apex

| | OmniStudio (declarative) | Apex (coded) |
|--|--------------------------|-------------|
| Build speed | Faster — drag-and-drop | Slower — write and test code |
| Flexibility | Limited to built-in element types | Unlimited logic |
| Maintenance | Non-developers can modify | Requires a developer |
| Use case | Standard guided processes, data reads/writes | Complex logic, edge cases |

Integration Procedures are still used underneath for anything OmniStudio's declarative tools can't express — at which point an Apex action is called from within the procedure.

## Interview answers

**"Have you worked with OmniStudio?"**
→ "Not directly, but I understand the building blocks — OmniScript for guided processes, DataRaptor for declarative data mapping, Integration Procedures for server-side orchestration. Given BCE's telecom and media scope, I'd ramp up on Communications Cloud catalog and order concepts quickly — the underlying LWC/Apex patterns I already know are what sit below the declarative layer."

**"How does an Integration Procedure differ from an Apex class?"**
→ "Both orchestrate logic and external calls, but Integration Procedures are built declaratively — JSON-configured drag-and-drop — rather than coded. Faster to build and modify by non-developers, but less flexible for complex logic. Apex is still used underneath for anything the declarative tools can't express."

**"Bell has both a telecom and a media business — how does that affect Industries Clouds?"**
→ "Both run on the same OmniStudio toolkit, just different industry data models: Communications Cloud for connectivity (plans, devices, bundles), Media Cloud for the content side (subscriptions, ad sales, rights). The underlying skills — OmniScript, DataRaptor, Integration Procedures, FlexCards — transfer between them."
