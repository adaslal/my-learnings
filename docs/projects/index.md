---
title: My Salesforce Apps
---

# My Salesforce Apps

Real apps built and deployed. Each one teaches specific patterns worth knowing.

## Flow Health

**What it is:** A Salesforce app that analyzes Flows in your org — scans for anti-patterns, dead ends, missing error handling, and complexity scores. Gives a health grade per Flow.

**Live:** Dev org, connected via `FlowHealth_SelfOrg` Named Credential

**Key technical patterns:**
- Calls Salesforce Tooling API from within Salesforce itself — using a Named Credential pointing to your own org's `.my.salesforce.com` endpoint
- `UserInfo.getSessionId()` returns `null` in LWC context — uses the **Visualforce bridge pattern** to get a valid session ID (VF page runs with a session, LWC reads it via `postMessage`)
- Permission set deploys the app visibility, but `userPermissions` (`ApiEnabled`, `ManageFlows`, `RunFlows`) cannot be set via metadata XML — must be done in Setup UI
- Flow User checkbox must be manually enabled on the User record for full Flow API access

**UI notes (from the redesign):**
- Native `lightning-card`, `lightning-datatable`, `lightning-button` render in their own closed shadow root — their chrome (borders, title bars, internal padding) **cannot be restyled** from this component's CSS. Only an org-level Lightning theme change can affect those. Dark mode in a custom LWC will go dark everywhere except native SLDS components — this is a platform constraint, not a bug.
- CSS custom properties on `:host` for the full token system (spacing, radius, surface/border/text colors, shadows) — replacing hardcoded hex values

**Deploying changes:**
```bash
sf project deploy start --source-dir force-app/main/default/lwc/flowHealthApp
```

---

## Flow Modernizer

**What it is:** Converts Salesforce Workflow Rules into equivalent Flows. Analyze a workflow rule, generate the Flow XML, deploy it directly.

**Key technical constraints:**
- `UserInfo.getSessionId()` returns `null` in LWC context → **VF bridge is mandatory, never revert**
- Remote Site must point to `.my.salesforce.com` (NOT `-setup.com` — that's the setup-only domain)
- PermissionSet app visibility must be enabled manually via Setup after deployment
- Value types in generated Flow XML default to String — numeric/boolean fields need manual correction in Flow Builder

**Phase 2 planned:** Add Approval Process converter as a second tab (replaces Workflow-to-Flow)

---

## CPQ Billing Navigator

**What it is:** A Next.js AI chat app (RAG-based) that answers questions about Salesforce CPQ and Billing. Ask it anything about the price waterfall, product rules, order generation, or billing periods and it retrieves from a curated knowledge base.

**Live:** https://cpq-navigator.vercel.app | https://github.com/adaslal/Salesforce-CPQ-and-Billing-Navigator

**Stack:** Next.js, claude-opus-4-5, VoyageAI voyage-3 embeddings, Pinecone serverless, Supabase

**Architecture:**
```
User question → VoyageAI embeds it → Pinecone semantic search (253 vectors, 21 KB files)
→ top-k chunks retrieved → Claude answers with context
→ conversation stored in Supabase psa_conversations table
```

**Key constraints:**
- Pinecone must use lazy `getPinecone()` — NOT module-level init (crashes Next.js build)
- Model: `claude-opus-4-5` only (hardcoded — don't change)
- `mode` state replaces `explainSimply` boolean — never reintroduce the boolean
- `lastConversation` = `history[0]` at submission

**v5 knowledge base topics (21 files, 253 vectors):** multi-currency, MDQ, contracted pricing, QCP plugins, order generation, payment gateway, debug guide, finance periods, quote templates, tax, Apex triggers + all core CPQ topics

---

## PSA Navigator

**What it is:** Same RAG architecture as CPQ Navigator but for Certinia PSA. Answers questions about project management, rate cards, revenue recognition, milestones, and resource management.

**Live:** https://psa-navigator.vercel.app | https://github.com/adaslal/psa-navigator

**Stack:** Next.js 16.2.1, claude-opus-4-5, VoyageAI voyage-3, Pinecone serverless, Supabase

**Key constraints:**
- Supabase table is `psa_conversations` (not `conversations`)
- Module filter param is `selectedModule`
- Pinecone index: `psa-navigator-docs`
- 14 knowledge base files, 170 vectors
- Mirrors CPQ Navigator architecture exactly

---

## Sanity Suite Web

**What it is:** Developer tools portal — Apex Code Visualizer, Version Diff, Custom Rules, PDF Reports, Snapshots.

**Live:** https://sanity-suite.vercel.app

**Key constraint:** All parsers must use ES6 `export` syntax (not CommonJS `module.exports`) for Next.js compatibility. Route stays at `/tools/apex-visualizer` to preserve links.

---

## Common patterns across apps

**VF session bridge (Flow Health, Flow Modernizer):**
```
LWC → embeds hidden VF page → VF page gets real session ID → postMessage to LWC parent
```
Used whenever you need `UserInfo.getSessionId()` to return a real value inside a Lightning component.

**RAG architecture (CPQ Navigator, PSA Navigator):**
```
Question → embed → vector search → top-k chunks → Claude with context → answer
```
Pinecone for vectors, VoyageAI for embeddings, Supabase for conversation history.

**Metadata-based config (HubSpot, SharePoint integrations):**
Custom Metadata Types for static config (never SOQL to read), Custom Settings for per-user runtime state (tokens, preferences).
