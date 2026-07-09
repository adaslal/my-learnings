---
title: Discount Schedules
---

# Discount Schedules

Tiered discounting attached to a product or referenced by a Price Rule. Built from **Discount Tiers** (Lower Bound / Upper Bound → discount %).

## Two types

| Type | Tier driver |
|------|------------|
| **Quantity (Volume) Schedule** | Number of units on the line |
| **Term Schedule** | Subscription length (e.g., 12-month = 0%, 24-month = 5%, 36-month = 10%) |

## Range vs Slab

| | Range | Slab (Graduated) |
|--|-------|-----------------|
| How discount applies | Whole quantity gets the one matching tier's rate | Each tier's units discounted at that tier's own rate, summed |
| Example (30 units, tiers: 1–10 = 5%, 11–50 = 10%) | All 30 at 10% | First 10 at 5%, next 20 at 10% |

## Order when both apply

If a product has both a Volume Schedule and a Term Schedule, CPQ always applies **volume discount first**, then the term discount.
