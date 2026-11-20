# Search

Intranet search (`GET /api/search`, the Search page, and `GET /api/v1/search`
for integrations) has three optional layers:

| Layer | Turned on by | What it adds |
|---|---|---|
| MySQL full-text | always | The baseline. Used for everything when nothing else is configured. |
| OpenSearch | `OPENSEARCH_URL` | Better ranking for posts, comments, tasks, investments and docs: word forms ("priced" finds "pricing"), typo tolerance, partial words while typing, accent-insensitive matching. |
| Connected sources | `RETRIEVAL_SUITE_*` | A "Connected sources" section with documents from external systems (Google Drive, Confluence, SharePoint, …) through a [RheinInsights Retrieval Suite](https://www.rheininsights.com), limited to what the member may open in those systems. |

People, AI agents and the ledger always use MySQL search.

## OpenSearch

### How it works

OpenSearch decides **what matches and in which order**. MySQL stays the
authority on **who may see it**: every hit is re-loaded from MySQL with the
same permission rules the MySQL search uses (`server/lib/postVisibility.js` for
posts and comments, approved-only for investments, admin-only docs). An index
that is a minute behind can therefore only cost a result, never show one a
member is not allowed to see. The index also stores permission fields, so the
top results a member gets are already filtered to things they can open.

If OpenSearch is unreachable or returns an error, search falls back to MySQL
for that request and logs `Search index unavailable` at most once a minute.
The response field `search_backend` says which one answered.

`server/cron/searchIndexer.js` keeps the index current:

- **Full rebuild** at start-up and every `SEARCH_INDEX_REBUILD_MINS` (default 60):
  builds a new index `<prefix>-content-<timestamp>` from MySQL, then switches
  the alias `<prefix>-content` to it in one step and deletes the old one. This is
  what removes deleted rows from the index.
- **Incremental pass** every `SEARCH_INDEX_INTERVAL_SECS` (default 30): rows whose
  `updated_at` changed, plus posts and comments whose visibility grants changed.

### Setting it up

1. Run OpenSearch somewhere the Owtranet server can reach. A single node is
   enough; for a small intranet 512 MB of heap is plenty. With Docker, bound to
   localhost only:

   ```bash
   docker run -d --name opensearch --restart unless-stopped \
     -p 127.0.0.1:9200:9200 \
     -e discovery.type=single-node \
     -e DISABLE_SECURITY_PLUGIN=true -e DISABLE_INSTALL_DEMO_CONFIG=true \
     -e OPENSEARCH_JAVA_OPTS="-Xms512m -Xmx512m" \
     -v opensearch-data:/usr/share/opensearch/data \
     opensearchproject/opensearch:2.19.3
   ```

   Only disable the security plugin when port 9200 is not reachable from other
   machines. Otherwise keep it on and set `OPENSEARCH_USERNAME`,
   `OPENSEARCH_PASSWORD` (and `OPENSEARCH_INSECURE_TLS=true` for the demo
   certificate).

   OpenSearch refuses to create indexes when its disk is more than 90% full
   (the "high disk watermark"). Make sure the volume has room, or the hourly
   rebuild fails; the indexer then keeps the current index up to date
   incrementally and retries the rebuild every 5 minutes.

2. Add to `.env`:

   ```
   OPENSEARCH_URL=http://127.0.0.1:9200
   ```

3. Build the index once and check it:

   ```bash
   node server/cron/searchIndexer.js                     # dry run: what would be indexed
   node server/cron/searchIndexer.js --apply --rebuild   # build it
   ```

4. Start the `owtranet-search-indexer` app from `ecosystem.config.js`
   (`--apply --daemon`) and restart `owtranet` so it reads the new `.env`.

5. Admins can check `GET /api/search-index/status`: the index the alias points
   at and how many documents of each kind it holds.

Several instances can share one cluster by giving each its own
`OPENSEARCH_INDEX_PREFIX`.

## Connected sources (Retrieval Suite)

The RheinInsights Retrieval Suite crawls external systems with their
document-level permissions into a search index and answers queries for one
user at a time. Owtranet calls it **server-side** with the signed-in member's
email address as the user principal, so:

- the Suite's token never reaches a browser or the mobile app;
- results are what that member may open in the source system;
- only `title`, `url` (http/https only), `teaser`, `score`, `source` and
  `modified` are passed on. Other metadata, which can include access-control
  data, is dropped;
- a slow or failing Suite never breaks search: after `RETRIEVAL_SUITE_TIMEOUT_MS`
  (default 4000) the section shows "Connected sources are unavailable right
  now". The Search page loads connected sources in a separate request, so
  intranet results never wait for them.

### Setting it up

1. Run the Retrieval Suite (licensed separately by RheinInsights). Their
   [Docker examples](https://github.com/RheinInsights/retrieval-suite-docker)
   include a complete OpenSearch setup. Configure the connectors you need and a
   **query pipeline** in the Suite's UI.
2. Members must be known to the Suite by an email address Owtranet also has:
   `users.email` (default) or `users.company_email`
   (`RETRIEVAL_SUITE_IDENTITY=company_email`). Map other identities with the
   Suite's principal transformation.
3. Add to `.env` and restart:

   ```
   RETRIEVAL_SUITE_URL=https://suite.internal.example.com
   RETRIEVAL_SUITE_PIPELINE_ID=1
   RETRIEVAL_SUITE_TOKEN=<pipeline access token>
   ```

   `RETRIEVAL_SUITE_MODE=async` switches to the Suite's submit-and-poll API;
   `RETRIEVAL_SUITE_AUTH_SCHEME=bearer` sends `Authorization: Bearer <token>`
   instead of the raw token; `RETRIEVAL_SUITE_INSECURE_TLS=true` accepts a
   self-signed certificate. Which mode, scheme and token type allow per-user
   queries depends on how the query pipeline's access is configured: check
   with your Suite version and RheinInsights.

The Search page shows a "Connected sources" tab only when this is configured.

## Search for integrations

`GET /api/v1/search?q=…&type=all` (API token) returns the same JSON as
`/api/search`, as the token's member, or as `acting_user_id` for tokens allowed
to act on behalf of a caller (e.g. a voice agent answering a member's
question). It includes connected sources when they are configured.
