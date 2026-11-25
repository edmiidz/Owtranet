# Enterprise search (OpenSearch)

Owtranet's own search covers what lives in the intranet's MySQL database. Enterprise
search adds a second section of results from an **OpenSearch** index that another
system fills, so members can find documents from websites, SharePoint, Confluence,
Google Drive and the like from the same search box.

It is off unless `OPENSEARCH_URL` is set. Small instances do not need it; it is meant for
teams that already run, or want to run, an indexer.

## How it works

```
 other systems ──► indexer (e.g. Retrieval Suite connectors) ──► OpenSearch index
                                                                       │
 member types a query ──► GET /api/search ──► MySQL sections           │
                                     └──────► server/lib/enterpriseSearch.js ──┘
                                               (permission filter, 4 s timeout)
```

- The query runs in parallel with the MySQL queries. If OpenSearch errors or times out
  (`OPENSEARCH_TIMEOUT_MS`, default 4000), the response still has every intranet
  section, plus `enterpriseError: "unavailable"`.
- Documents split into chunks are shown once (collapsed on `originalId`), with a
  highlighted snippet. Results link to the original system; only `http(s)` links are
  returned.
- The tab and section appear only when enterprise search is configured. Their name
  comes from `ENTERPRISE_SEARCH_LABEL` (default "Enterprise").
- `?type=enterprise` asks for enterprise results only.

## Permissions

Each indexed document carries `allow_acl` and `deny_acl` keyword fields written by the
indexer. Owtranet builds the member's list of principals and asks OpenSearch only for
documents where one of them is in `allow_acl` and none is in `deny_acl`. Filtering
happens inside the OpenSearch query, so a document the member may not see is never
returned to the server, let alone the browser.

- Everyone gets the public principal, `OPENSEARCH_PUBLIC_ACL` (default
  `G_____everyone`, the Retrieval Suite's "everyone" group).
- With `RETRIEVAL_SUITE_URL` and `RETRIEVAL_SUITE_ACL_TOKEN`, Owtranet also calls the
  Suite's security-trimming API (`GET /api/v1/securitytrimming/acls?id=<address>`) with
  the member's company address and personal address, and adds the principals it
  returns. Answers are cached for five minutes per address. Turn the API on in the
  Suite under General Settings → API Management.
- If that lookup is not configured or fails, the member sees public documents only. A
  failure narrows results; it never widens them.

## Setting it up with the RheinInsights Retrieval Suite

1. Run the Suite with OpenSearch (RheinInsights publishes Docker Compose examples), add
   connectors and crawl. Use one document index for all connectors so Owtranet searches
   one place.
2. Create a **read-only** OpenSearch user for Owtranet, limited to the document index:

   ```bash
   curl -k -u admin:… -X PUT https://opensearch.example.com:9200/_plugins/_security/api/roles/owtranet_read \
     -H 'Content-Type: application/json' \
     -d '{"index_permissions":[{"index_patterns":["documentindex"],"allowed_actions":["read"]}]}'
   curl -k -u admin:… -X PUT https://opensearch.example.com:9200/_plugins/_security/api/internalusers/owtranet_reader \
     -H 'Content-Type: application/json' -d '{"password":"…"}'
   curl -k -u admin:… -X PUT https://opensearch.example.com:9200/_plugins/_security/api/rolesmapping/owtranet_read \
     -H 'Content-Type: application/json' -d '{"users":["owtranet_reader"]}'
   ```

3. Set in `.env`: `OPENSEARCH_URL`, `OPENSEARCH_USERNAME`, `OPENSEARCH_PASSWORD`, and
   `ENTERPRISE_SEARCH_LABEL` if you want another name for the section.
4. If OpenSearch uses a private or self-signed certificate, set `OPENSEARCH_CA_FILE` to
   the CA's PEM file. If the certificate does not name the host Owtranet connects to
   (for example the demo certificate, reached by IP), also pin it with
   `OPENSEARCH_TLS_FINGERPRINT` (`openssl x509 -noout -fingerprint -sha256`). The pin
   replaces the hostname check, and any other certificate is refused.
5. Allow the Owtranet server to reach OpenSearch (firewall / security group), restart,
   and search for something the indexer crawled.

Members' addresses must match the identities the indexer records for them (for
Microsoft 365 or Google Workspace sources, usually `users.company_email`).
