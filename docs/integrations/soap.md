---
title: SOAP Integration
---

# SOAP Integration

## REST vs SOAP

| | REST | SOAP |
|--|------|------|
| Format | JSON (usually) | XML (always) |
| Contract | No formal schema | WSDL defines every operation |
| Tooling | HttpRequest / HttpResponse | `WSDL2Apex` generates classes |
| Use case | Modern APIs | Legacy enterprise systems (SAP, Oracle EBS, older banks) |

## WSDL2Apex (automated)

1. Get the WSDL file from the external system.
2. Setup → Apex Classes → Generate from WSDL → upload the file.
3. Salesforce generates stub classes. Call them like any Apex class.

```apex
// Generated stub — call like normal Apex
MyService.MyPort port = new MyService.MyPort();
port.endpoint_x = 'callout:MySoapNC'; // use Named Credential
MyService.ResponseType result = port.myOperation(request);
```

## Manual SOAP callout (when WSDL2Apex isn't available)

```apex
public class ManualSoapCallout {
    public static String callExternalService(String inputValue) {
        String soapBody =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">' +
            '  <soapenv:Body>' +
            '    <ns:myOperation xmlns:ns="http://example.com/service">' +
            '      <ns:input>' + inputValue + '</ns:input>' +
            '    </ns:myOperation>' +
            '  </soapenv:Body>' +
            '</soapenv:Envelope>';

        HttpRequest req = new HttpRequest();
        req.setEndpoint('callout:MySoapNC/service/endpoint');
        req.setMethod('POST');
        req.setHeader('Content-Type', 'text/xml; charset=UTF-8');
        req.setHeader('SOAPAction', '"myOperation"');
        req.setBody(soapBody);

        HttpResponse res = new Http().send(req);
        // Parse res.getBody() as XML using Dom.Document
        Dom.Document doc = new Dom.Document();
        doc.load(res.getBody());
        Dom.XmlNode root = doc.getRootElement();
        // navigate nodes...
        return root.getChildElement('Body', null)?.getText();
    }
}
```
