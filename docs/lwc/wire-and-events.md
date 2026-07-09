---
title: Wire & Events
---

# Wire Service & Custom Events

## Wire — reading Salesforce data

```js
import { LightningElement, wire, api } from 'lwc';
import { getRecord, getFieldValue } from 'lightning/uiRecordApi';
import NAME_FIELD from '@salesforce/schema/Account.Name';

export default class AccountName extends LightningElement {
    @api recordId;

    @wire(getRecord, { recordId: '$recordId', fields: [NAME_FIELD] })
    account;

    get name() {
        return getFieldValue(this.account.data, NAME_FIELD);
    }
}
```

## Imperative Apex call

```js
import { LightningElement, api } from 'lwc';
import syncTimecards from '@salesforce/apex/TimecardController.syncTimecards';

export default class SyncButton extends LightningElement {
    @api recordId;
    loading = false;
    error;

    handleSync() {
        this.loading = true;
        syncTimecards({ recordId: this.recordId })
            .then(() => { this.loading = false; })
            .catch(err => { this.error = err; this.loading = false; });
    }
}
```

## Custom Events (child → parent)

```js
// Child fires the event
this.dispatchEvent(new CustomEvent('statuschange', { detail: { newStatus: 'Approved' } }));
```

```html
<!-- Parent listens -->
<c-child-component onstatuschange={handleStatusChange}></c-child-component>
```

```js
// Parent handler
handleStatusChange(event) {
    console.log(event.detail.newStatus); // 'Approved'
}
```
