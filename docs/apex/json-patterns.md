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

## JSON.deserialize() vs JSON.deserializeUntyped() — side by side

This is the decision that trips people up most often. Same input, completely different output and usage pattern.

**Same JSON used in both examples:**
```json
{
  "orderId": "ORD-001",
  "amount": 1500.00,
  "status": "Pending",
  "lines": [
    { "sku": "PROD-A", "qty": 3 },
    { "sku": "PROD-B", "qty": 1 }
  ]
}
```

---

### JSON.deserialize() — typed, dot-notation access

Define an Apex class that mirrors the JSON shape. Salesforce maps field-by-field automatically. You get full dot-notation access (`result.orderId`, `result.lines[0].sku`).

```apex
// Step 1: define a class that mirrors the JSON shape
public class OrderResponse {
    public String orderId;
    public Decimal amount;
    public String status;
    public List<LineItem> lines;

    public class LineItem {
        public String sku;
        public Integer qty;
    }
}

// Step 2: one line to parse
OrderResponse result = (OrderResponse) JSON.deserialize(responseBody, OrderResponse.class);

// Step 3: use it like a normal Apex object
System.debug(result.orderId);           // ORD-001
System.debug(result.amount);            // 1500.00
System.debug(result.lines[0].sku);      // PROD-A
System.debug(result.lines[0].qty);      // 3

// Loop over lines cleanly
for (OrderResponse.LineItem line : result.lines) {
    System.debug(line.sku + ' × ' + line.qty);
}
```

**Field name matching is CASE-INSENSITIVE** — `orderId` in JSON matches `orderId`, `OrderId`, or `ORDERID` in your Apex class. This forgives minor casing differences from the API.

**DANGER:** Always wrap in try/catch — a malformed response throws `JSONException` and kills the transaction:

```apex
try {
    OrderResponse result = (OrderResponse) JSON.deserialize(responseBody, OrderResponse.class);
} catch (JSONException e) {
    throw new IntegrationException('Malformed response: ' + e.getMessage());
}
```

---

### JSON.deserializeUntyped() — untyped, map/cast navigation

No class needed. Returns `Map<String,Object>` for JSON objects, `List<Object>` for JSON arrays. You navigate by key and cast every value manually.

```apex
// One line to parse — no class required
Map<String,Object> result = (Map<String,Object>) JSON.deserializeUntyped(responseBody);

// Access top-level fields — must cast every value
String orderId = (String)  result.get('orderId');   // ORD-001
Decimal amount  = (Decimal) result.get('amount');    // 1500.00
String status   = (String)  result.get('status');    // Pending

// Navigate the nested array
List<Object> lines = (List<Object>) result.get('lines');
for (Object lineObj : lines) {
    Map<String,Object> line = (Map<String,Object>) lineObj;
    String sku = (String)  line.get('sku');
    Integer qty = (Integer) line.get('qty');
    System.debug(sku + ' × ' + qty);
}
```

The extra casting everywhere is the tradeoff — you get flexibility without needing a class, but every value comes out as `Object` and must be cast to the right type before you can use it.

---

### Head-to-head comparison

| | `JSON.deserialize()` | `JSON.deserializeUntyped()` |
|--|----------------------|-----------------------------|
| **Requires Apex class** | Yes — must match JSON shape | No |
| **Access style** | Dot-notation: `result.lines[0].sku` | Cast + get: `(String) line.get('sku')` |
| **Type safety** | Compile-time — wrong type = compile error | Runtime — wrong cast = `ClassCastException` |
| **JSON structure must be known** | Yes | No — works with any shape |
| **Apex reserved words in JSON** | Fails (`type`, `class`, etc.) | Works fine — keys are just strings |
| **Structure varies by response** | Fails — fixed class shape | Works — navigate conditionally |
| **Verbosity** | Low — clean dot-notation | High — cast on every access |
| **Use when** | You control or know the API shape | External/unpredictable API, or JSON has reserved-word keys |

---

### When reserved words break deserialize()

If the API returns a field called `type`, `class`, or `abstract` (Apex reserved words), `JSON.deserialize()` throws a compile error because you can't declare a class field with those names. `deserializeUntyped()` has no problem — map keys are just strings:

```apex
// This JSON would break JSON.deserialize() — "type" is an Apex reserved word
// { "id": "001", "type": "Customer", "class": "Premium" }

// deserializeUntyped() handles it fine
Map<String,Object> parsed = (Map<String,Object>) JSON.deserializeUntyped(responseBody);
String recordType  = (String) parsed.get('type');   // Customer
String tierClass   = (String) parsed.get('class');  // Premium
```

### When the structure varies at runtime

Some APIs return different shapes based on a status field — `deserializeUntyped()` lets you branch on the structure after parsing:

```apex
Map<String,Object> parsed = (Map<String,Object>) JSON.deserializeUntyped(responseBody);
String status = (String) parsed.get('status');

if (status == 'success') {
    Map<String,Object> data = (Map<String,Object>) parsed.get('data');
    // handle success shape
} else {
    String errorCode = (String) parsed.get('errorCode');
    // handle error shape
}
```

You can't do this with `deserialize()` — it expects one fixed class shape.

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
