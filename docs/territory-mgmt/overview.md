# Enterprise Territory Management (ETM)

> **Gap identified in BCE Global Tech interview (July 2026).** Full notes coming soon.

## What it is
Enterprise Territory Management (ETM) is a Salesforce feature that assigns Accounts — and optionally Opportunities — to a territory hierarchy, separate from the Role Hierarchy. Used in orgs with geographic, industry, or product-based sales team structures.

## Key objects
- **Territory Type** — categorises territories (e.g., Geographic, Named Account)
- **Territory Model** — the container for a territory hierarchy (can have multiple models, only one Active at a time)
- **Territory** — an individual territory node in the hierarchy
- **Account Territory Assignment** — links an Account to a Territory
- **User Territory Association** — assigns a rep to a Territory

## How Opportunity assignment works
Once ETM is active, Opportunities can be assigned to territories via:
1. **Standard filter rules** — run when Account territory changes
2. **Manually** on the Opportunity record
3. **Flow or Apex** for custom logic

## Difference from Role Hierarchy
| | Role Hierarchy | Territory Management |
|--|----------------|---------------------|
| Based on | Org chart / reporting lines | Sales coverage model (geography, industry, etc.) |
| Controls | Record visibility (sharing) | Account/Opportunity assignment to sales reps |
| Multiple hierarchies | No | Yes (multiple Territory Models, one active) |

## When you'd use it
- Large sales orgs where a rep covers a geographic region regardless of who owns the Account
- Named account models where specific reps own specific companies
- Overlay sales (specialist reps assigned across multiple territories)