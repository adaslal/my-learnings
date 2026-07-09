---
title: LWC Basics
---

# LWC Basics

## Component bundle structure

Each component is a folder containing:
- `myComponent.html` — template
- `myComponent.js` — controller
- `myComponent.js-meta.xml` — metadata (where it's exposed)
- `myComponent.css` — scoped styles (optional)

## Decorators

| Decorator | Purpose |
|-----------|---------|
| `@api` | Exposes a property or method to parent components |
| `@track` | Deprecated — all object/array properties are reactive by default now |
| `@wire` | Binds a property or function to a Salesforce data source |

## Data flow rule

- Data flows **down** via `@api` properties (parent to child).
- Events flow **up** via `CustomEvent` (child to parent).
- Siblings communicate via a shared parent or a Lightning Message Service channel.

## LWC vs Aura

- LWC is the current standard. Use LWC for everything new.
- Aura can contain LWC, but LWC cannot contain Aura.
- Only reach for Aura if you need a feature not yet available in LWC.
