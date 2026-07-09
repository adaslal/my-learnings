---
title: Product & Price Rules
---

# Product Rules & Price Rules

## Product Rules — govern which products/combinations are valid

Four types:

| Type | Behaviour |
|------|-----------|
| **Validation** | Blocks Save/Calculate with an error message until the condition is met. |
| **Selection** | Auto adds, removes, enables, disables, or hides options within a bundle. |
| **Filter** | Pre-filters which products are offered as options in a bundle. |
| **Alert** | Non-blocking — shows a pop-up, lets the rep continue. Often paired with approval requirements. |

## Price Rules — manipulate price/field values

Separate from Product Rules. Built from:
- **Condition** — formula or lookup query that determines when the rule fires.
- **Price Actions** — inject a static value, field reference, or formula result into a target field (e.g., `Special Price`, `List Price`, quantity).

**Evaluation Events** (when the rule fires — pick one per rule for performance):

| Event | When it runs |
|-------|-------------|
| Before Calculate | Before CPQ calculates quantities — can affect what gets calculated |
| On Calculate | Once right after quantities are set |
| After Calculate | After all calculations are done |

Classic example: a Price Rule that auto-increments ink cartridge quantity whenever printer quantity increases on the same quote.
