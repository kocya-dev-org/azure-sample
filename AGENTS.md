# Project context

## Overview

Flyingfish is an Azure Static Web Apps sample. The frontend is static HTML, the API uses SWA managed Azure Functions v4 with the TypeScript v4 programming model, and Cosmos DB for NoSQL plus Blob Storage hold application data.

## Repository layout and deployed architecture

- `infra/main.bicep`: resource-group-scoped deployment. Cosmos DB and application Blob Storage are in Japan East (`japaneast`); the SWA managed Functions backend is in East Asia (`eastasia`), a supported managed API region. It creates a Free tier Static Web App, a Free Tier Cosmos DB account, and an application data storage account.
- Cosmos DB and Blob Storage have public network access enabled. Blob containers stay private. Both services use account connection strings stored as SWA API application settings. Cosmos DB local/key authentication is enabled for this connection-string sample.
- Cosmos DB uses the Free Tier and a shared-throughput database at 400 RU/s, with an account throughput cap of 1,000 RU/s. Free Tier eligibility is limited to one account per subscription and covers up to 1,000 RU/s and 25 GB of storage.
- `infra/environments/dev.bicepparam`: development parameters for `main.bicep`, including the Japan East data location and `dev` tag.
- `src/frontend/`: static site files. `index.html` is the Japanese-language sample page. `staticwebapp.config.json` selects Node.js 22 for managed Functions and sets SWA route authentication.
- `src/api/`: SWA managed Azure Functions v4 API, built with TypeScript and configured for Node.js 22. HTTP handlers are under `src/api/src/functions/`. Managed Functions supports HTTP triggers only, so this project has no timer trigger.
- `.github/workflows/deploy.yml`: path-filtered Bicep validation and deployment, SWA API connection-string settings, and combined frontend plus managed API deployment.

There is no root package manifest. The API's `package.json` and `tsconfig.json` are the source of truth for its build configuration. The SWA deployment uses `npm run build` in `src/api`.

## Working conventions

- Keep infrastructure changes in Bicep and environment-specific values in `infra/environments/*.bicepparam`. Preserve the resource-group deployment scope unless the architecture is intentionally changed.
- Keep frontend assets in `src/frontend/` and API handlers in `src/api/src/functions/`. The frontend calls APIs through the `/api/...` path on the same Static Web App host.
- Keep the managed Functions runtime consistent between `src/api/package.json` and `src/frontend/staticwebapp.config.json` unless a deliberate runtime change updates both and the deployment assumptions.
- Keep the Cosmos DB and Blob Storage location in `infra/main.bicep` and `infra/environments/dev.bicepparam` consistent with the intended data region. SWA managed Functions are limited to supported regions; the current API region is East Asia.
- Treat changes to Azure resource properties, public network rules, runtime versions, deployment paths, GitHub permissions, and secret names as coordinated changes. Do not put credential values in source files.
- The workflow validates infrastructure with `az bicep lint`, `az bicep build`, and `az bicep build-params`. Azure deployments use GitHub OIDC credentials (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) and `AZURE_RESOURCE_GROUP`; SWA deployment uses `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- No test suite or root-level build command is currently defined. Check package scripts and workflow steps before documenting or relying on additional validation commands.

## Change guidance

- Keep names, user-facing copy, and comments consistent with the existing Japanese-language sample unless the requested change calls for another language.
- When adding deployable files or moving code, update `.github/workflows/deploy.yml` paths and build/deployment locations as needed. Its change filters watch `src/**` and `infra/**`.
- Avoid introducing frameworks, dependencies, or new deployment mechanisms for a small sample change unless they are needed for the requested behavior.
