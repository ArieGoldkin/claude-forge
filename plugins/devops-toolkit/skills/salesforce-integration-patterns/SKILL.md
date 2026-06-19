---
name: salesforce-integration-patterns
description: "Salesforce CRM integration — bidirectional sync, case management, webhooks, bulk operations, SOQL queries"
effort: low
paths:
  - "**/*salesforce*"
  - "**/*sfdc*"
keep-coding-instructions: true
---

# Salesforce Integration Patterns

Production patterns for Salesforce CRM ↔ application backend integration (AWS Lambda, Python).

## Quick Start

### Client Setup

Use a global Salesforce client with Secrets Manager authentication:

```python
# utils/salesforce_client.py
from simple_salesforce import Salesforce
from aws_lambda_powertools import Logger
import boto3, json, os

class SalesforceClient:
    def __init__(self):
        self._client = None
        self._secrets = boto3.client('secretsmanager')

    @property
    def client(self):
        if not self._client:
            creds = json.loads(self._secrets.get_secret_value(
                SecretId=os.getenv("SALESFORCE_SECRET_NAME")
            )["SecretString"])
            self._client = Salesforce(**creds)
        return self._client

sf_client = SalesforceClient()
```

### User Sync Pattern

Upsert application users to Salesforce Contacts using an external ID custom field:

```python
# Check + upsert pattern.
# SOQL has no bind-parameter API in simple_salesforce, so the value is
# interpolated — VALIDATE it first to prevent SOQL injection. user.id is your
# own PK, so a strict allowlist is both safe and sufficient.
import re
user_ext_id = str(user.id)
if not re.fullmatch(r"[A-Za-z0-9_-]+", user_ext_id):
    raise ValueError("unexpected External_User_ID format")

existing = sf_client.client.query(
    f"SELECT Id FROM Contact WHERE External_User_ID__c = '{user_ext_id}'"
)
# Tip: prefer upsert-by-external-id to skip the query+branch entirely:
#   sf_client.client.Contact.upsert(f"External_User_ID__c/{user_ext_id}", sf_data)

sf_data = {
    "Email": user.email,
    "External_User_ID__c": user.id,
    "User_Status__c": user.status,
    "Subscription_Status__c": user.subscription.status
}

if existing["totalSize"] > 0:
    sf_client.client.Contact.update(existing["records"][0]["Id"], sf_data)
else:
    sf_client.client.Contact.create(sf_data)
```

## Integration Workflows

### User Lifecycle Events
```
user.created            → Create Salesforce Contact
user.updated            → Update Contact fields
subscription.started    → Update Subscription_Status__c
subscription.cancelled  → Update status + Create support Case
```

### Case Management
```
Salesforce Case → Webhook → API Gateway → Lambda → App DB
```
- Verify HMAC-SHA256 signature (`X-SF-Signature` header)
- Store case in application DB with `sf_case_id` reference
- Notify user via SES or notification channel

### Bulk Sync
```
CloudWatch (nightly) → Fetch active users → Salesforce Bulk API (upsert)
```
- Use `bulk.Contact.upsert()` for >200 records
- External ID: `External_User_ID__c`
- Batch size: 200

## Custom Salesforce Fields

Required on Contact object (rename fields to match your domain):
- `External_User_ID__c` (Text, External ID, Unique) — your application's user ID
- `User_Status__c` (Picklist: active, inactive, churned)
- `Subscription_Status__c` (Picklist: trial, active, cancelled, expired)
- `Tags__c` or `Segments__c` (Multi-Picklist) — domain-specific categorization
- `Last_Sync_Date__c` (DateTime)

## Security Notes

- **SOQL injection**: SOQL has no bind-parameter API in `simple_salesforce`; any value interpolated into a query string must be validated/escaped first (see the User Sync pattern above). Prefer upsert-by-external-id over query-then-branch where possible.
- **Webhook authenticity**: verify the `X-SF-Signature` HMAC-SHA256 on inbound Case webhooks before trusting the payload.
- **Least privilege**: scope the integration user's profile to only the objects/fields it syncs.

## Adopting for Your Domain

Rename `External_User_ID__c`, `User_Status__c`, and `Tags__c` to match your domain's terminology (e.g., `Member_ID__c`, `Patient_ID__c`, `Customer_ID__c`). The patterns (upsert by external ID, HMAC webhook verification, Bulk API with >200 records) remain the same regardless of domain.
