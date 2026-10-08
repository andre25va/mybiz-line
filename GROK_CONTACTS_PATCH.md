# Grok contacts PATCH contract

`PATCH /api/grok/contacts` continues to require the existing `Authorization: Bearer <MYBIZ_API_KEY>` credential. It is the owner assistant's operational endpoint across its authorized accounts/apps; it is not changed to impose session-owner or per-user row filtering.

The legacy request shape uses `phone` as the contact selector, for example:

```json
{ "phone": "7609842145", "name": "Yolanda Rustad" }
```

In this shape `phone` is **only a selector** and is not written to the contact. Phone matching preserves the existing last-ten-digits contains lookup, but the route now proceeds only when that lookup identifies exactly one contact; no match returns 404 and multiple matches return 409. The update is then made against that selected row's ID, rather than repeating a broad phone match in the PATCH request.

To intentionally change a contact's phone, specify the current contact phone separately as `lookup_phone` and provide the new phone in `phone`:

```json
{ "lookup_phone": "7609842145", "phone": "8165357923" }
```

New phone values use the existing US/E.164 normalization helper. Supported writable contact fields are `name`, `phone`, `email`, `address`, `notes`, `business`, `tags`, `deal_tag`, and `status`. Fields such as `id`, `user_id`, `updated_at`, `created_at`, and unknown properties are not forwarded to the database. No timestamp field is sent.

Malformed PATCH payloads return 400. Database rejection returns 502 with a sanitized provider code when supplied; network failure returns 503. For this PATCH path, raw provider messages/bodies, request URLs, credentials, and contact data are not included in failure responses or PATCH database-error logs. A database update that returns no row is not reported as success. Existing GET/POST helper behavior is otherwise unchanged.
