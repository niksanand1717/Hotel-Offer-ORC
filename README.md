# Hotel Offer Orchestrator

Aggregates hotel offers from two mock suppliers, de-duplicates hotels by name, keeps the best (cheapest) offer per hotel, and supports price-range filtering. Temporal orchestrates the process and Redis stores the results.

**Stack:** Node.js 22 · TypeScript · NestJS (Express adapter) · Temporal · Redis · Docker Compose

---

## Architecture

```mermaid
flowchart LR
    C[Client] -->|GET /api/hotels| API[NestJS API]
    API -->|execute hotelOffersWorkflow| T[(Temporal Server)]
    T --> W[Temporal Worker]
    W -->|fetchSupplierHotels A| SA[GET /supplierA/hotels]
    W -->|fetchSupplierHotels B| SB[GET /supplierB/hotels]
    W -->|saveHotelOffers| R[(Redis)]
    API -->|ZRANGEBYSCORE price filter| R
```

The request flow:

1. `GET /api/hotels?city=delhi[&minPrice=&maxPrice=]` validates the query and starts `hotelOffersWorkflow` on Temporal.
2. The **workflow** calls Supplier A and Supplier B **in parallel**. Each call is a separate activity with its own timeout and retry policy.
3. The workflow **de-duplicates by hotel name**, ignoring case and surrounding whitespace, and keeps the cheaper offer. A hotel returned by only one supplier is kept as-is.
4. A `saveHotelOffers` activity **saves the de-duplicated list to Redis**, replacing the previous list for that city in a single `MULTI` transaction.
5. The API then applies the **price filter inside Redis**: a Lua script runs `ZRANGEBYSCORE` on the price index and `HMGET`s the matching offers in one atomic round trip. Results come back sorted by price, cheapest first.

The worker runs as a separate process (`src/worker.ts`), so it can be scaled independently of the HTTP API.

### Redis data model

| Key                      | Type       | Contents                                   |
| ------------------------ | ---------- | ------------------------------------------ |
| `hotels:{city}:by_price` | Sorted set | member = hotel key, score = price          |
| `hotels:{city}:offers`   | Hash       | hotel key → offer JSON                     |

Both keys expire after `HOTEL_CACHE_TTL_SECONDS` (default 300). The `{city}` hash tag keeps both keys in the same slot, so the Lua script also works on Redis Cluster.

### De-duplication rules

- Hotels are matched by name, ignoring case and surrounding whitespace (`"Holtin"` = `" holtin "`).
- The lowest price wins.
- If the prices are equal, the offer with the higher `commissionPct` wins, then the supplier name decides. The result is therefore the same whatever order the suppliers answer in.

### Failure handling

| Scenario                              | Behaviour                                                                                         |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Supplier times out / returns 5xx      | The activity is retried 3 times with exponential backoff.                                         |
| Supplier returns 4xx / invalid payload | The activity fails without retrying. Malformed hotel records are skipped and a warning is logged. |
| One supplier down                     | The workflow continues with the other supplier. The response is `200` and includes an `X-Failed-Suppliers` header naming the failed supplier. |
| All suppliers down                    | The workflow fails with `AllSuppliersUnavailable` and the API returns `502 Bad Gateway`.          |
| Temporal or Redis unavailable         | The API returns `503 Service Unavailable`.                                                         |
| Invalid query                         | The API returns `400` (`city` missing or invalid, a price that is negative or not a number, or `minPrice > maxPrice`). |

Activities and workflows log through Temporal's logger. You can also inspect every workflow run, including its activity retries, in the Temporal UI at <http://localhost:8080>.

---

## Quick start (Docker Compose)

Requirements: Docker with the Compose plugin.

```bash
git clone <repo-url> hotel-offer-orchestrator
cd hotel-offer-orchestrator
docker compose up -d --build
```

This starts:

| Service       | Port  | Purpose                                     |
| ------------- | ----- | ------------------------------------------- |
| `api`         | 3000  | NestJS HTTP API and the mock suppliers      |
| `worker`      | –     | Temporal worker (workflows and activities)  |
| `redis`       | –     | Stores offers and runs the price filter     |
| `temporal`    | 7233  | Temporal server (auto-setup)                |
| `postgresql`  | –     | Temporal persistence                        |
| `temporal-ui` | 8080  | Temporal Web UI                             |

To use different host ports, set `API_PORT`, `TEMPORAL_PORT` or `TEMPORAL_UI_PORT`, for example `API_PORT=4000 docker compose up -d`.

Check that it is running:

```bash
curl http://localhost:3000/health
curl "http://localhost:3000/api/hotels?city=delhi"
```

To stop the stack, run `docker compose down`. Add `-v` to also delete Temporal's database volume.

### Deploying

The same image runs both roles:

- **API:** `node dist/main.js` (the default `CMD`)
- **Worker:** `node dist/worker.js`

To deploy anywhere else, build and push the image, then run at least one API and one worker container. Point both at your Redis and Temporal (or Temporal Cloud) using the environment variables below. The API has no state of its own, and you can add more workers to handle more load.

```bash
docker build -t <registry>/hotel-offer-orchestrator:1.0.0 .
docker push <registry>/hotel-offer-orchestrator:1.0.0
```

### Using Temporal Cloud

The API and worker can use Temporal Cloud instead of the local Temporal server. Connections to Temporal Cloud use TLS and are authenticated with an API key or an mTLS client certificate.

1. In the Temporal Cloud UI, create a namespace. Note its **namespace id** (for example `hotel-offers.a1b2c`) and its **gRPC endpoint**.
2. Create an API key under **Settings → API Keys** and give it access to the namespace.
3. Configure and start the stack:

   ```bash
   cp .env.cloud.example .env.cloud   # fill in the endpoint, namespace and API key
   docker compose -f docker-compose.yml -f docker-compose.cloud.yml \
     --env-file .env.cloud up -d --build api worker redis
   ```

   Only the API, worker and Redis start. The local Temporal server, Postgres and Temporal UI are not needed, and workflow runs appear in the Temporal Cloud UI.

Without Docker, set the same variables in `.env` and run `npm run start:dev` and `npm run start:worker:dev`.

| Variable                 | Description                                                                 |
| ------------------------ | --------------------------------------------------------------------------- |
| `TEMPORAL_ADDRESS`       | The namespace's gRPC endpoint                                               |
| `TEMPORAL_NAMESPACE`     | `<namespace>.<account-id>`                                                  |
| `TEMPORAL_API_KEY`       | API key (turns on TLS)                                                      |
| `TEMPORAL_TLS_CERT_PATH` | mTLS client certificate (PEM), used instead of an API key. Set it with `TEMPORAL_TLS_KEY_PATH`. |
| `TEMPORAL_TLS_KEY_PATH`  | mTLS private key (PEM)                                                      |

For a managed Redis, set `REDIS_URL`. Use `rediss://user:pass@host:port` for a TLS connection.

### Deploying to Google Cloud Run

`scripts/deploy-cloud-run.sh` builds the image with Cloud Build and deploys two Cloud Run services from it:

| Service              | Command               | Settings                                                                  |
| -------------------- | --------------------- | ------------------------------------------------------------------------- |
| `hotel-offer-api`    | `node dist/main.js`   | Public. Scales from 0 to 10 instances.                                    |
| `hotel-offer-worker` | `node dist/worker.js` | Internal ingress only. CPU always allocated (`--no-cpu-throttling`). At least 1 instance. |

The worker gets no HTTP traffic; it polls Temporal for work. Cloud Run normally pauses the CPU of a service between requests, so the worker service keeps its CPU allocated and always runs at least one instance. Cloud Run also requires every service to listen on `$PORT`. When the worker detects Cloud Run (`K_SERVICE` is set), it starts a small health endpoint on that port. The endpoint returns `200` while the worker is polling and `503` otherwise.

Both services connect to **Temporal Cloud** (see above) and to a **Redis instance that Cloud Run can reach**:

- **Upstash or Redis Cloud** is the simplest option. Set `REDIS_URL=rediss://default:<password>@<host>:<port>`.
- **Memorystore** needs a private network connection. Set `REDIS_URL=redis://<private-ip>:6379` and `VPC_NETWORK`/`VPC_SUBNET`. The script then deploys both services with Direct VPC egress.

Steps:

```bash
gcloud auth login
cp .env.cloud.example .env.cloud     # fill in GCP_PROJECT, Temporal Cloud and REDIS_URL
./scripts/deploy-cloud-run.sh
```

You can run the script again at any time. It creates only what is missing:

- It enables the Cloud Run, Artifact Registry, Cloud Build and Secret Manager APIs.
- It creates an Artifact Registry repository and a runtime service account.
- It stores `TEMPORAL_API_KEY` and `REDIS_URL` in **Secret Manager**, so they never appear in plain service configuration. A new secret version is added only when a value changes.
- It builds and pushes the image, then deploys the API. The worker is deployed next, with `SUPPLIER_BASE_URL` set to the API's URL.

At the end it prints the API URL:

```bash
curl https://hotel-offer-api-xxxxx.run.app/health
curl "https://hotel-offer-api-xxxxx.run.app/api/hotels?city=delhi"
```

To run the Postman collection against the deployment, set the collection's `baseUrl` variable to the API URL.

Optional overrides (as environment variables or in `.env.cloud`):

- `API_MIN_INSTANCES` and `API_MAX_INSTANCES`
- `WORKER_MIN_INSTANCES` and `WORKER_MAX_INSTANCES`
- `IMAGE_TAG`
- `AR_REPOSITORY`, `API_SERVICE`, `WORKER_SERVICE` and `RUN_SERVICE_ACCOUNT`

Notes:

- **Cost:** the worker's always-on instance is billed continuously. Set `WORKER_MIN_INSTANCES=0` only if you accept that workflows wait for a cold start.
- **Admin endpoint:** `PUT /admin/suppliers/:id` is public on the deployed API, as it is locally. It only toggles the mock suppliers.
- **Organization policies:** if your organization blocks `--allow-unauthenticated`, the API deploy fails at that step. Ask an admin to allow public access for this service.

---

## Local development

Requirements: Node.js 22+, plus a running Redis and Temporal. The simplest way to get both is to start only those services from Compose:

```bash
npm install
cp .env.example .env
docker compose up -d redis temporal temporal-ui   # starts postgresql as well
npm run start:dev          # terminal 1: API with watch mode
npm run start:worker:dev   # terminal 2: Temporal worker
```

If something is already using port 6379 on your machine, publish the Compose Redis on another port and update `REDIS_URL` to match.

### Configuration

| Variable                   | Default                   | Description                                           |
| -------------------------- | ------------------------- | ----------------------------------------------------- |
| `PORT`                     | `3000`                    | HTTP port of the API                                  |
| `REDIS_URL`                | `redis://localhost:6379`  | Redis connection string                               |
| `HOTEL_CACHE_TTL_SECONDS`  | `300`                     | Expiry for stored offers                              |
| `TEMPORAL_ADDRESS`         | `localhost:7233`          | Temporal frontend address                             |
| `TEMPORAL_NAMESPACE`       | `default`                 | Temporal namespace                                    |
| `TEMPORAL_TASK_QUEUE`      | `hotel-offers`            | Task queue shared by the API and the worker           |
| `SUPPLIER_BASE_URL`        | `http://localhost:$PORT`  | Where the worker and `/health` reach the mock suppliers |
| `SUPPLIER_TIMEOUT_MS`      | `3000`                    | HTTP timeout for each supplier call                   |
| `SUPPLIERS_DOWN`           | _(empty)_                 | Suppliers that start in the down state, e.g. `A` or `A,B` |
| `WORKER_HEALTH_PORT`       | _(off; `$PORT` on Cloud Run)_ | Port for the worker's health endpoint                 |

---

## API

### `GET /api/hotels?city=<city>[&minPrice=<n>][&maxPrice=<n>]`

Returns the de-duplicated, best-priced offers for a city, cheapest first. `minPrice` and `maxPrice` are optional and inclusive.

```bash
curl "http://localhost:3000/api/hotels?city=delhi&minPrice=5000&maxPrice=10000"
```

```json
[
  { "name": "Holtin", "price": 5340, "supplier": "Supplier B", "commissionPct": 20 },
  { "name": "Radison", "price": 5900, "supplier": "Supplier A", "commissionPct": 13 },
  { "name": "The Oberoi", "price": 9800, "supplier": "Supplier B", "commissionPct": 18 }
]
```

A city with no hotels returns `[]`. The mock data covers `delhi` and `mumbai` from both suppliers, and `bangalore` from Supplier B only.

### Mock suppliers

- `GET /supplierA/hotels[?city=delhi]`
- `GET /supplierB/hotels[?city=delhi]`

Each returns records in the supplier format (`hotelId`, `name`, `price`, `city`, `commissionPct`). Several hotel names appear at both suppliers with different prices.

### `PUT /admin/suppliers/:id` — simulate an outage

```bash
curl -X PUT localhost:3000/admin/suppliers/A -H 'Content-Type: application/json' -d '{"available": false}'
```

While a supplier is down, its mock endpoint returns `503`. Send `{"available": true}` to bring it back. This toggle exists only to support the mock suppliers.

### `GET /health`

Reports the health of each supplier plus Redis and Temporal:

```json
{
  "status": "degraded",
  "timestamp": "2026-09-23T14:04:57.665Z",
  "suppliers": {
    "Supplier A": { "status": "down", "latencyMs": 9, "error": "HTTP 503" },
    "Supplier B": { "status": "up", "latencyMs": 9, "hotels": 9 }
  },
  "dependencies": {
    "redis": { "status": "up", "latencyMs": 5 },
    "temporal": { "status": "up", "latencyMs": 6 }
  }
}
```

| `status`   | HTTP | Meaning                                                    |
| ---------- | ---- | ---------------------------------------------------------- |
| `ok`       | 200  | Everything is up                                           |
| `degraded` | 200  | One supplier is down. Hotel results are still returned, but may be incomplete. |
| `down`     | 503  | No supplier is reachable, or Redis or Temporal is down     |

---

## Testing

```bash
npm test            # unit tests: de-duplication rules, query validation
npm run test:e2e    # mock supplier endpoints and the outage toggle
```

### Postman

Import `postman/hotel-offer-orchestrator.postman_collection.json`. The collection uses a `baseUrl` variable, which defaults to `http://localhost:3000`. It contains:

- **Health**: both suppliers reported up
- **Mock suppliers**: the supplier payloads overlap
- **Hotels**:
  - a valid city with overlapping hotels (`delhi`), with checks on de-duplication and on which supplier wins
  - price range, min-only and max-only filters
  - a city served by a single supplier
  - a city with no results (`paris`)
  - validation errors
- **Supplier outage simulation**, which must be run in order:
  1. Take Supplier A down.
  2. Check that `/health` reports `degraded` and that the results carry the `X-Failed-Suppliers` header.
  3. Take Supplier B down too, and check for a `502` from the hotels endpoint and a `503` from `/health`.
  4. Restore both suppliers.

To run it from the command line:

```bash
npx newman run postman/hotel-offer-orchestrator.postman_collection.json
```

---

## Project layout

```
src/
  main.ts                    API entrypoint
  worker.ts                  Temporal worker entrypoint
  config.ts                  Environment configuration
  common/                    Shared types and the pure de-duplication logic
  hotels/                    GET /api/hotels: validation and workflow execution
  suppliers/                 Mock supplier endpoints, static data, outage toggle
  temporal/                  Workflow, activities, Temporal client module
  redis/                     Redis client module and HotelOfferStore (save, filter by price)
  health/                    GET /health
postman/                     Postman collection
Dockerfile                   Multi-stage build; one image for both API and worker
docker-compose.yml           Full stack: API, worker, Redis, Temporal, Postgres, Temporal UI
docker-compose.cloud.yml     Override: run API and worker against Temporal Cloud
scripts/deploy-cloud-run.sh  Build and deploy to Google Cloud Run
```
