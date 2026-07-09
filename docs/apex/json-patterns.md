---
title: JSON Patterns
---

# JSON Patterns in Apex

## Three methods, three use cases

| Method | Input → Output | Use when |
|--------|---------------|----------|
| `JSON.serialize()` | Apex object → JSON String | Sending data to an external API |
| `JSON.deserialize()` | JSON String → Typed Apex class | You know the exact JSON structure at compile time |
| `JSON.deserializeUntyped()` | JSON String → `Map<String,Object>` or `List<Object>` | Unknown/variable structure, or JSON contains reserved Apex words |

---

## JSON.serialize()

```apex
// Converts any Apex object, list, or map into a JSON string
// Field names in output match Apex variable names exactly (camelCase by default)

public class OrderPayload {
    public String orderNumber;
    public Decimal amount;
    public String status;
}

OrderPayload payload = new OrderPayload();
payload.orderNumber = 'ORD-001';
payload.amount = 1500.00;
payload.status = 'Pending';

String json = JSON.serialize(payload);
// {"orderNumber":"ORD-001","amount":1500.0,"status":"Pending"}

// Suppress null fields:
String cleanJson = JSON.serialize(payload, true);  // second param = suppressNulls
```

---

## JSON.deserialize()

```apex
// Use when you know the exact JSON shape — define a matching Apex class
// Field name matching is CASE-INSENSITIVE

public class ErpResponse {
    public String status;
    public String transactionId;
    public List<LineItem> lines;

    public class LineItem {
        public String sku;
        public Integer qty;
    }
}

String responseBody = res.getBody();
ErpResponse result = (ErpResponse) JSON.deserialize(responseBody, ErpResponse.class);
String txId = result.transactionId;
```

**DANGER:** Always wrap in try/catch — a malformed response throws `JSONException` and kills your transaction:

```apex
try {
    ErpResponse result = (ErpResponse) JSON.deserialize(responseBody, ErpResponse.class);
} catch (JSONException e) {
    throw new IntegrationException('Malformed ERP response: ' + e.getMessage());
}
```

---

## JSON.deserializeUntyped()

```apex
// Use when:
// - JSON structure is unknown at compile time
// - JSON contains Apex reserved words (type, class, abstract, etc.)
// - Structure varies by response type

Map<String,Object> body = (Map<String,Object>) JSON.deserializeUntyped(res.getBody());

// Navigate nested objects:
Map<String,Object> data = (Map<String,Object>) body.get('data');
String status = (String) data.get('status');

// Navigate arrays:
List<Object> items = (List<Object>) body.get('items');
for (Object item : items) {
    Map<String,Object> itemMap = (Map<String,Object>) item;
    String sku = (String) itemMap.get('sku');
    Integer qty = (Integer) itemMap.get('qty');
}
```

### Handling Apex reserved words in JSON

If the API returns a field called `type` or `class` (Apex reserved words), `JSON.deserialize()` fails. Use `deserializeUntyped()` and navigate manually:

```apex
Map<String,Object> parsed = (Map<String,Object>) JSON.deserializeUntyped(body);
String recordType = (String) parsed.get('type');   // "type" as a map key is fine
```

---

## Serializing SObjects

```apex
// Serialize a queried record (includes only fields queried)
Account acct = [SELECT Id, Name, Phone FROM Account LIMIT 1];
String json = JSON.serialize(acct);
// {"attributes":{"type":"Account","url":"..."},"Id":"001...","Name":"Acme","Phone":"..."}

// If you want clean output without Salesforce metadata attributes, use a wrapper class instead
```

---

## Common gotchas

**Camel case vs snake_case:** `JSON.serialize()` outputs camelCase matching your Apex variable names. If the external API expects `order_number`, you either rename your Apex variable or post-process the string.

**Date/Datetime serialization:** Dates serialize as ISO strings (`2024-01-15`). Datetimes serialize as `2024-01-15T10:30:00.000Z`. The external API may expect a different format — serialize manually to a String field if needed.

**Integer vs Long:** `JSON.deserializeUntyped()` returns whole numbers as `Integer` if they fit, `Long` if they don't. For large numbers (Unix timestamps, large IDs), cast to `Long`:

```apex
Long timestamp = (Long) body.get('timestamp');
```

**Null handling:** `JSON.deserialize()` sets missing fields to null. `JSON.deserializeUntyped()` doesn't include missing keys — use `body.containsKey('field')` before casting.

---

## Building JSON manually (when you need exact control)

```apex
// Sometimes you need a specific structure that doesn't map cleanly to Apex classes
Map<String,Object> payload = new Map<String,Object>{
    'grant_type' => 'client_credentials',
    'client_id' => clientId,
    'client_secret' => clientSecret,
    'scope' => new List<String>{'read', 'write'}
};
String body = JSON.serialize(payload);
```
