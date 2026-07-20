---
title: Loqate Address Verification
---

# Loqate Address Verification — Contact Edit Override

Replaces the standard Contact Edit button with a custom LWC that lets users verify the mailing address against Loqate's API before saving. Pattern: **third-party validation step wired into a standard object's save flow**.

## Architecture

```
User clicks Edit on Contact
        │
        ▼
contactEditOverride (Aura wrapper)  ← required for Edit button override picker
        │
        ▼
contactAddressVerification (LWC)
  – loads Contact via lightning/uiRecordApi
  – user edits Name + Mailing Address fields
  – clicks "Verify Address"
        │
        ▼
LoqateAddressVerificationService (Apex)
  → POST https://api.loqate.com/address/verify/v2
  – parses Status field in response
        │
        ▼
ShowToastEvent  ← green "Verified" or red error toast
        │
        ▼
Save (lightning/uiRecordApi updateRecord)
```

## Why there's an Aura wrapper

**Salesforce won't let you pick an LWC directly in the standard button override picker** — only Aura components and Visualforce pages appear in the list. The fix is a minimal Aura wrapper that implements `lightning:actionOverride` + `force:hasRecordId` and embeds the real LWC, passing `recordId` through.

```xml
<!-- contactEditOverride.cmp — minimal wrapper, no logic -->
<aura:component implements="lightning:actionOverride,force:appHostable,force:hasRecordId">
    <c:contactAddressVerification recordId="{!v.recordId}" />
</aura:component>
```

Then: Setup → Object Manager → Contact → Buttons, Links, and Actions → Edit → Lightning Experience Override → select `c:contactEditOverride`.

This pattern applies whenever you need to override standard New/Edit/View/Tab actions with a custom experience. The Aura wrapper is purely structural — all business logic stays in the LWC.

## Apex service — LoqateAddressVerificationService

Loqate's `/address/verify` endpoint takes the API key as a **JSON body field** (`lqtkey`), not an HTTP auth header. The Named Credential is used only to externalize the base URL — authentication is handled in the request body.

```apex
public with sharing class LoqateAddressVerificationService {

    private static final String API_KEY     = 'YOUR_LOQATE_API_KEY'; // store in Protected Custom Metadata
    private static final String ENDPOINT    = 'callout:Loqate_Address_Verify/address/verify/v2';
    private static final Integer TIMEOUT_MS = 10000;

    public class VerifyResult {
        @AuraEnabled public Boolean isVerified;
        @AuraEnabled public String  message;
        @AuraEnabled public String  verifiedAddress; // standardized address from Loqate
    }

    public class VerifyException extends Exception {}

    @AuraEnabled
    public static VerifyResult verifyAddress(
            String line1, String city, String state, String postalCode, String country) {

        // Build request payload
        Map<String, Object> addressBlock = new Map<String, Object>{
            'Address1'   => line1,
            'Locality'   => city,
            'AdminArea'  => state,
            'PostalCode' => postalCode,
            'Country'    => country
        };
        Map<String, Object> payload = new Map<String, Object>{
            'lqtkey'   => API_KEY,
            'input'    => new List<Object>{ addressBlock }
        };

        HttpRequest req = new HttpRequest();
        req.setEndpoint(ENDPOINT);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(payload));
        req.setTimeout(TIMEOUT_MS);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            throw new VerifyException('Loqate returned ' + res.getStatusCode() + ': ' + res.getBody());
        }

        return parseResponse(res.getBody());
    }

    private static VerifyResult parseResponse(String body) {
        VerifyResult result = new VerifyResult();
        try {
            List<Object>        outer    = (List<Object>)       JSON.deserializeUntyped(body);
            Map<String, Object> first    = (Map<String, Object>) outer[0];
            List<Object>        output   = (List<Object>)       first.get('output');
            Map<String, Object> addrData = (Map<String, Object>) output[0];

            String status = (String) addrData.get('AQI'); // Address Quality Index
            // "A" = perfect match, "B" = good, "C" = partial. Reject D/E/null.
            result.isVerified     = (status == 'A' || status == 'B');
            result.verifiedAddress = (String) addrData.get('Address');
            result.message = result.isVerified
                ? 'Address verified successfully'
                : 'Address could not be verified (status: ' + status + ')';
        } catch (Exception e) {
            result.isVerified = false;
            result.message    = 'Unexpected response format: ' + e.getMessage();
        }
        return result;
    }
}
```

## Named Credential setup

| Field | Value |
|-------|-------|
| Label / Name | `Loqate_Address_Verify` |
| URL | `https://api.loqate.com` |
| Authentication Protocol | No Authentication |
| Generate Authorization Header | Unchecked |

No authentication in the NC because Loqate authenticates via the `lqtkey` field in the JSON body.

## LWC key points

```javascript
// contactAddressVerification.js
import { LightningElement, api, wire } from 'lwc';
import { getRecord, updateRecord } from 'lightning/uiRecordApi';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import verifyAddress from '@salesforce/apex/LoqateAddressVerificationService.verifyAddress';

export default class ContactAddressVerification extends LightningElement {
    @api recordId;

    async handleVerify() {
        try {
            const result = await verifyAddress({
                line1: this.mailingStreet,
                city: this.mailingCity,
                state: this.mailingState,
                postalCode: this.mailingPostalCode,
                country: this.mailingCountry
            });

            this.dispatchEvent(new ShowToastEvent({
                title: result.isVerified ? 'Verified' : 'Verification Failed',
                message: result.message,
                variant: result.isVerified ? 'success' : 'error'
            }));
        } catch (error) {
            this.dispatchEvent(new ShowToastEvent({
                title: 'Error', message: error.body.message, variant: 'error'
            }));
        }
    }

    async handleSave() {
        const fields = { Id: this.recordId, /* ...address fields */ };
        await updateRecord({ fields });
        // navigate back to record detail
    }
}
```

## Patterns demonstrated

| Pattern | How it appears here |
|---------|-------------------|
| **Edit button override** | Aura wrapper → LWC; required because LWC can't appear in the standard override picker directly |
| **API key in body (not header)** | Loqate uses `lqtkey` in JSON body — Named Credential still used for the base URL |
| **Validate before save** | Verification call happens before `updateRecord` — user sees result, can choose to save or fix |
| **`ShowToastEvent`** | Green/red toast based on API response, within a custom edit screen |
| **`lightning/uiRecordApi`** | `getRecord` to load current values, `updateRecord` to save after verification |
