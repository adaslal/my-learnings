---
title: Loqate Address Verification
---

# Loqate Address Verification — Contact Edit Override

Replaces the standard Contact Edit button with a custom LWC that lets users verify the mailing address against Loqate's API before saving. Pattern: **third-party validation step wired into a standard object's save flow**.

---

## Architecture

```
User clicks Edit on Contact
        │
        ▼
contactEditOverride (Aura wrapper)  ← required for Edit button override picker
        │
        ▼
contactAddressVerification (LWC)
  – loads Contact via @wire(getRecord)
  – user edits Name + Mailing Address fields
  – clicks "Verify Address"
        │
        ▼
LoqateAddressVerificationService (Apex) → POST https://api.loqate.com/address/verify/v2
  – parses Status + output[] → returns VerifyResult wrapper
        │
        ▼
ShowToastEvent  ← green "Verified" or red error toast
        │
        ▼
updateRecord (lightning/uiRecordApi) on Save
```

---

## Why there's an Aura wrapper

**Salesforce won't let you pick an LWC directly in the standard button override picker** — only Aura components and Visualforce pages appear in the list. The fix is a minimal Aura wrapper that implements `lightning:actionOverride` + `force:hasRecordId` and embeds the real LWC, passing `recordId` through.

```xml
<!-- contactEditOverride.cmp — purely structural, no logic -->
<aura:component implements="lightning:actionOverride,force:appHostable,force:hasRecordId">
    <c:contactAddressVerification recordId="{!v.recordId}" />
</aura:component>
```

Setup → Object Manager → Contact → Buttons, Links, and Actions → Edit → Lightning Experience Override → select `c:contactEditOverride`.

---

## Apex — LoqateAddressVerificationService

Loqate authenticates via the `lqtkey` field in the **JSON request body** — not an HTTP Authorization header. The Named Credential externalizes the base URL only.

```apex
public with sharing class LoqateAddressVerificationService {

    // Store in Protected Custom Metadata in production — never hardcode
    private static final String API_KEY  = 'YOUR_LOQATE_API_KEY';
    private static final String ENDPOINT = 'callout:Loqate_Address_Verify/address/verify/v2';

    public class VerifyResult {
        @AuraEnabled public Boolean isVerified;
        @AuraEnabled public String  message;
        @AuraEnabled public String  formattedAddress; // standardized address from Loqate
    }

    @AuraEnabled
    public static VerifyResult verifyAddress(
            String address1, String address2,
            String city, String stateProvince,
            String postalCode, String country) {

        Map<String, Object> addressBlock = new Map<String, Object>{
            'Address1'   => address1,
            'Address2'   => address2,
            'Locality'   => city,
            'AdminArea'  => stateProvince,
            'PostalCode' => postalCode,
            'Country'    => country
        };
        Map<String, Object> payload = new Map<String, Object>{
            'lqtkey' => API_KEY,   // API key goes in the body, NOT in headers
            'input'  => new List<Object>{ addressBlock }
        };

        HttpRequest req = new HttpRequest();
        req.setEndpoint(ENDPOINT);
        req.setMethod('POST');
        req.setHeader('Content-Type', 'application/json');
        req.setBody(JSON.serialize(payload));
        req.setTimeout(10000);

        HttpResponse res = new Http().send(req);
        if (res.getStatusCode() != 200) {
            VerifyResult r = new VerifyResult();
            r.isVerified = false;
            r.message    = 'Loqate returned HTTP ' + res.getStatusCode();
            return r;
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

            // AQI = Address Quality Index: A/B = match, C = partial, D/E = poor
            String aqiStatus = (String) addrData.get('AQI');
            result.isVerified     = ('A'.equals(aqiStatus) || 'B'.equals(aqiStatus));
            result.formattedAddress = (String) addrData.get('Address');
            result.message = result.isVerified
                ? 'Address verified successfully'
                : 'Address could not be verified (AQI: ' + aqiStatus + ')';
        } catch (Exception e) {
            result.isVerified = false;
            result.message    = 'Unexpected response: ' + e.getMessage();
        }
        return result;
    }
}
```

---

## LWC — contactAddressVerification

### HTML

```html
<template>
    <lightning-card title="Edit Contact" icon-name="standard:contact">
        <div class="slds-p-around_medium">

            <!-- Loading spinner while getRecord wire loads -->
            <template lwc:if={isLoading}>
                <lightning-spinner alternative-text="Loading" size="small"></lightning-spinner>
            </template>

            <!-- Name fields -->
            <div class="slds-grid slds-gutters slds-wrap">
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input
                        label="First Name"
                        value={firstName}
                        data-field="firstName"
                        onchange={handleFieldChange}>
                    </lightning-input>
                </div>
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input
                        label="Last Name"
                        value={lastName}
                        data-field="lastName"
                        onchange={handleFieldChange}>
                    </lightning-input>
                </div>
            </div>

            <!-- Address fields -->
            <div class="slds-m-top_small">
                <lightning-input
                    label="Mailing Street"
                    value={mailingStreet}
                    data-field="mailingStreet"
                    onchange={handleFieldChange}>
                </lightning-input>
            </div>

            <div class="slds-grid slds-gutters slds-wrap slds-m-top_small">
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input label="City" value={mailingCity}
                        data-field="mailingCity" onchange={handleFieldChange}>
                    </lightning-input>
                </div>
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input label="State/Province" value={mailingState}
                        data-field="mailingState" onchange={handleFieldChange}>
                    </lightning-input>
                </div>
            </div>

            <div class="slds-grid slds-gutters slds-wrap slds-m-top_small">
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input label="Postal Code" value={mailingPostalCode}
                        data-field="mailingPostalCode" onchange={handleFieldChange}>
                    </lightning-input>
                </div>
                <div class="slds-col slds-size_1-of-2">
                    <lightning-input label="Country" value={mailingCountry}
                        data-field="mailingCountry" onchange={handleFieldChange}>
                    </lightning-input>
                </div>
            </div>

            <!-- Verified address summary (shows after successful verification) -->
            <template lwc:if={addressVerified}>
                <div class="slds-m-top_small slds-text-color_success">
                    <lightning-icon icon-name="utility:success" size="x-small" variant="success">
                    </lightning-icon>
                    <span class="slds-m-left_x-small">Address verified — {verifiedAddressSummary}</span>
                </div>
            </template>

            <!-- Action buttons -->
            <div class="slds-m-top_medium slds-grid slds-grid_align-spread">
                <lightning-button
                    variant="neutral"
                    label="Verify Address"
                    icon-name="utility:location"
                    onclick={handleVerifyAddress}
                    disabled={isVerifying}>
                </lightning-button>

                <div>
                    <lightning-button variant="neutral" label="Cancel"
                        class="slds-m-right_small" onclick={handleCancel}>
                    </lightning-button>
                    <lightning-button variant="brand" label="Save"
                        onclick={handleSave} disabled={isSaving}>
                    </lightning-button>
                </div>
            </div>

        </div>
    </lightning-card>
</template>
```

### JavaScript

```javascript
import { LightningElement, api, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { NavigationMixin } from 'lightning/navigation';
import { getRecord, getFieldValue, updateRecord } from 'lightning/uiRecordApi';
import verifyAddress from '@salesforce/apex/LoqateAddressVerificationService.verifyAddress';

// Schema imports — field references compile-checked, safe to rename/deploy
import ID_FIELD           from '@salesforce/schema/Contact.Id';
import FIRST_NAME_FIELD   from '@salesforce/schema/Contact.FirstName';
import LAST_NAME_FIELD    from '@salesforce/schema/Contact.LastName';
import STREET_FIELD       from '@salesforce/schema/Contact.MailingStreet';
import CITY_FIELD         from '@salesforce/schema/Contact.MailingCity';
import STATE_FIELD        from '@salesforce/schema/Contact.MailingState';
import POSTAL_FIELD       from '@salesforce/schema/Contact.MailingPostalCode';
import COUNTRY_FIELD      from '@salesforce/schema/Contact.MailingCountry';

const FIELDS = [
    FIRST_NAME_FIELD, LAST_NAME_FIELD,
    STREET_FIELD, CITY_FIELD, STATE_FIELD, POSTAL_FIELD, COUNTRY_FIELD
];

export default class ContactAddressVerification extends NavigationMixin(LightningElement) {

    @api recordId;  // passed from the Aura wrapper

    // Form field values — initialized from @wire, editable by user
    firstName; lastName;
    mailingStreet; mailingCity; mailingState; mailingPostalCode; mailingCountry;

    isLoading         = true;
    isVerifying       = false;
    isSaving          = false;
    addressVerified   = false;
    verifiedAddressSummary = '';

    _hydrated = false; // guard: only hydrate from wire once, not on re-renders

    // ── Wire: load Contact fields ─────────────────────────────────────────────

    @wire(getRecord, { recordId: '$recordId', fields: FIELDS })
    wiredContact({ data, error }) {
        if (data) {
            if (!this._hydrated) {
                // getFieldValue() safely extracts field values from wire result
                this.firstName       = getFieldValue(data, FIRST_NAME_FIELD);
                this.lastName        = getFieldValue(data, LAST_NAME_FIELD);
                this.mailingStreet   = getFieldValue(data, STREET_FIELD);
                this.mailingCity     = getFieldValue(data, CITY_FIELD);
                this.mailingState    = getFieldValue(data, STATE_FIELD);
                this.mailingPostalCode = getFieldValue(data, POSTAL_FIELD);
                this.mailingCountry  = getFieldValue(data, COUNTRY_FIELD);
                this._hydrated = true;
            }
            this.isLoading = false;
        } else if (error) {
            this.isLoading = false;
            this._toast('Error', this._extractError(error), 'error');
        }
    }

    // ── Field change handler ──────────────────────────────────────────────────

    handleFieldChange(event) {
        // data-field attribute on the input maps to this[field] — generic handler for all inputs
        const field = event.target.dataset.field;
        this[field] = event.target.value;
        this.addressVerified = false; // any edit invalidates verification
    }

    // ── Verify Address — imperative Apex callout ──────────────────────────────

    async handleVerifyAddress() {
        this.isVerifying = true;
        try {
            // LWC calls Apex imperatively → Apex calls Loqate API → result back
            const result = await verifyAddress({
                address1:     this.mailingStreet,
                address2:     null,
                city:         this.mailingCity,
                stateProvince: this.mailingState,
                postalCode:   this.mailingPostalCode,
                country:      this.mailingCountry
            });

            if (result.isVerified) {
                this.addressVerified      = true;
                this.verifiedAddressSummary = result.formattedAddress;
                this._toast('Verified', 'Address verified successfully.', 'success');
            } else {
                this.addressVerified = false;
                this._toast('Not Verified', result.message, 'error');
            }
        } catch (err) {
            this.addressVerified = false;
            this._toast('Error', this._extractError(err), 'error');
        } finally {
            this.isVerifying = false;
        }
    }

    // ── Save — updateRecord via lightning/uiRecordApi ─────────────────────────

    async handleSave() {
        this.isSaving = true;
        const fields = {
            [ID_FIELD.fieldApiName]:      this.recordId,
            [FIRST_NAME_FIELD.fieldApiName]: this.firstName,
            [LAST_NAME_FIELD.fieldApiName]:  this.lastName,
            [STREET_FIELD.fieldApiName]:     this.mailingStreet,
            [CITY_FIELD.fieldApiName]:       this.mailingCity,
            [STATE_FIELD.fieldApiName]:      this.mailingState,
            [POSTAL_FIELD.fieldApiName]:     this.mailingPostalCode,
            [COUNTRY_FIELD.fieldApiName]:    this.mailingCountry
        };
        try {
            await updateRecord({ fields });
            this._toast('Saved', 'Contact updated.', 'success');
            this._goToRecord(); // navigate back to record detail view
        } catch (err) {
            this._toast('Error Saving', this._extractError(err), 'error');
        } finally {
            this.isSaving = false;
        }
    }

    handleCancel() {
        this._goToRecord();
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    _goToRecord() {
        this[NavigationMixin.Navigate]({
            type: 'standard__recordPage',
            attributes: { recordId: this.recordId, objectApiName: 'Contact', actionName: 'view' }
        });
    }

    _toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    _extractError(err) {
        return err?.body?.message || err?.message || 'Unknown error';
    }
}
```

---

## Named Credential setup

| Field | Value |
|-------|-------|
| Label / Name | `Loqate_Address_Verify` |
| URL | `https://api.loqate.com` |
| Authentication Protocol | No Authentication |

No authentication in the NC because Loqate authenticates via `lqtkey` in the JSON body.

---

## LWC patterns demonstrated

| Pattern | Where |
|---------|-------|
| **`@wire(getRecord)` with schema imports** | Loads Contact fields; `@salesforce/schema/Contact.MailingStreet` — compile-checked field references |
| **`getFieldValue()`** | Safe extraction from wire result — avoids manual `data.fields.X.value` path |
| **`_hydrated` guard** | Prevents wire from re-overwriting user edits when reactive `$recordId` triggers a re-evaluation |
| **`data-field` generic handler** | One `onchange` handler drives all input fields via `event.target.dataset.field` → `this[field]` |
| **Imperative Apex callout** | `await verifyAddress({...})` — button triggers LWC → Apex → Loqate |
| **Validate before save pattern** | Verification and save are separate actions — user can see the result before committing |
| **`updateRecord` (uiRecordApi)** | Saves field values to Salesforce after verification |
| **`NavigationMixin`** | Navigates back to record detail view after save or cancel |
| **`async/await` with `try/finally`** | `isVerifying`/`isSaving` always reset even on error |
| **Aura wrapper necessity** | LWC can't appear in standard Edit override picker — thin Aura wrapper is the workaround |
