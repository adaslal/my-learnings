---
title: Test Classes
---

# Test Classes

## Non-negotiable rules

- Minimum 75% code coverage to deploy — but **assert on outcomes**, don't just hit lines.
- Test at **bulk volume** (200 records) — triggers must handle it.
- Cover **positive, negative, and bulk** paths.
- Use `@TestSetup` for shared data — runs once per class, saves SOQL.
- Never use `SeeAllData=true` unless absolutely necessary (legacy orgs).

## Pattern

```apex
@IsTest
private class AccountTriggerHandlerTest {

    @TestSetup
    static void makeData() {
        List<Account> accounts = new List<Account>();
        for (Integer i = 0; i < 200; i++) {
            accounts.add(new Account(Name = 'Test Account ' + i));
        }
        insert accounts;
    }

    @IsTest
    static void testBulkInsert_createsRelatedRecords() {
        List<Account> accounts = [SELECT Id FROM Account];
        System.assertEquals(200, accounts.size(), 'Expected 200 accounts from setup');

        Test.startTest();
        // trigger the logic
        update accounts;
        Test.stopTest();

        // assert on outcomes, not just coverage
        Integer relatedCount = [SELECT COUNT() FROM Contact WHERE AccountId IN :accounts];
        System.assertEquals(200, relatedCount, 'Each account should have one related Contact');
    }

    @IsTest
    static void testNegativePath_throwsOnInvalidState() {
        Account acc = new Account(Name = 'Bad Account', BillingCountry = null);
        Boolean exceptionThrown = false;
        try {
            Test.startTest();
            insert acc;
            Test.stopTest();
        } catch (DmlException e) {
            exceptionThrown = true;
        }
        System.assert(exceptionThrown, 'Expected exception for missing BillingCountry');
    }
}
```

## Mocking callouts

```apex
// Implement HttpCalloutMock
@IsTest
global class MockHttpResponse implements HttpCalloutMock {
    global HttpResponse respond(HttpRequest req) {
        HttpResponse res = new HttpResponse();
        res.setStatusCode(200);
        res.setBody('{"status":"ok"}');
        return res;
    }
}

// Use it in your test
@IsTest
static void testCallout() {
    Test.setMock(HttpCalloutMock.class, new MockHttpResponse());
    Test.startTest();
    MyCalloutClass.doCallout();
    Test.stopTest();
    // assert on results
}
```
