# Data Modeling

_Notes coming soon._

## Key principles
- Lookup vs Master-Detail: Master-Detail cascades delete and rolls up; Lookup is independent
- Junction objects for many-to-many
- External IDs for integration upserts — always add one to any object that'll be fed from an external system
- Avoid excessive custom fields on high-volume objects (Account, Contact) — impacts query performance