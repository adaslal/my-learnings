# Quote → Order → Contract Flow

_Detailed notes coming soon. Key objects: SBQQ__Quote__c, SBQQ__QuoteLine__c, Order, OrderItem, Contract, SBQQ__Subscription__c_

## Quick reference
- Mark Quote **Primary = true** → syncs Quote Lines to Opportunity as Opportunity Line Items
- Opportunity **Closed Won** + Quote **Ordered = true** → creates Order
- Order **Contracted = true** → creates Contract
- Contract → Usage Trackers, Usage Summaries (usage-based billing)
- **Amend** button on Contract → Amendment Opportunity → Amendment Quote → Amendment Order
- **Renewal Forecast** on Contract → Renewal Opportunity; **Renewal Quoted** → adds persistent Renewal Quote