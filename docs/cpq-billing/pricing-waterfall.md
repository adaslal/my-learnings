---
title: Pricing Waterfall
---

# CPQ Pricing Waterfall

The waterfall is a strict top-to-bottom sequence. Each field feeds the one below it.

## The complete waterfall

| # | Field | API Name | What it is |
|---|-------|----------|------------|
| 1 | **Original Price** | `SBQQ__OriginalPrice__c` | Untouched price book value. Even if List Price is overridden, this stays as the original reference. |
| 2 | **List Price** | `SBQQ__ListPrice__c` | Price from the Price Book. Starting point. Overridden by Contracted Price if one exists for this Account/product. |
| 3 | **Contracted Price** | *(Account-level object)* | Account-level negotiated rate set via "Contracted Prices" related list. Replaces List Price as the input to Special Price. |
| 4 | **Special Price** | `SBQQ__SpecialPrice__c` | Calculated from Contracted Price (or List Price if none). **NOT prorated** for subscriptions — preferred injection point for Price Rules. Option Discounts also apply here. |
| 5 | **Regular Price** | `SBQQ__RegularPrice__c` | Special Price after Discount Schedules. **IS prorated** for subscriptions (e.g., $1,200/year on 6-month quote → $600). If no schedule, equals Special Price. |
| 6 | **Customer Price** | `SBQQ__CustomerPrice__c` | Regular Price minus **Additional Discount** % — the rep's manual lever in the Quote Line Editor. |
| 7 | **Partner Price** | `SBQQ__PartnerPrice__c` | Customer Price minus **Partner Discount** %. Channel/reseller scenarios. Zero in direct-sales orgs. |
| 8 | **Net Price** | `SBQQ__NetPrice__c` | Partner Price minus **Distributor Discount** %. **The final price** — syncs to Opportunity Product and gets invoiced. |

## Proration rule (critical for subscriptions)

- List Price, Special Price → **NOT prorated**
- Regular Price, Customer Price, Partner Price, Net Price → **ARE prorated**

This is why Price Rules that set subscription prices target **Special Price** — set the full annual amount there, CPQ handles proration downstream automatically.

## Discount types mapped to waterfall steps

| Discount type | Reduces | Result |
|---------------|---------|--------|
| Discount Schedule (volume/term tiers) | Special Price | Regular Price |
| Additional Discount (rep-applied %) | Regular Price | Customer Price |
| Partner Discount | Customer Price | Partner Price |
| Distributor Discount | Partner Price | Net Price |

## Special Fields that alter the waterfall order

Create these with the **exact API name** — CPQ detects them by name:

| Field on Quote | Effect |
|----------------|--------|
| `ApplyAdditionalDiscountLast__c` | Moves Additional Discount to after Partner/Distributor. Customer Price becomes the terminal value instead of Net Price. |
| `ApplyPartnerDiscountFirst__c` | Applies Partner Discount off List Price, before Discount Schedules. |
| `ChannelDiscountsOffList__c` | Applies Partner and Distributor discounts off List Price directly. |

## Alternative pricing methods (not part of the waterfall)

| Method | How it works |
|--------|-------------|
| **Block Pricing** | Fixed price per quantity block (e.g., 1–10 = $1,000 flat, 11–25 = $1,500 flat). Replaces List Price as the starting value. |
| **Cost + Markup** | List Price = Cost × (1 + Markup%). Good when product costs vary. |
| **Percent of Total** | Price = % of total quote value or a subset of lines (e.g., implementation fee = 15% of product total). |
