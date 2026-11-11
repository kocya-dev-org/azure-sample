# Project context

## Overview

Flyingfish is an Azure Static Web Apps sample with a separately hosted Azure Functions API. Infrastructure is declared in Bicep, the frontend is static HTML, and the API is implemented with TypeScript on Azure Functions v4.

## Repository layout and deployed architecture

- `infra/main.bicep`: resource-group-scoped deployment. The default region is Japan East (`japaneast`). It creates a Blob Storage static website for the frontend; a Linux Azure Functions Flex Consumption app; a VNet with a Flex Consumption integration subnet and a private endpoint subnet; Cosmos DB for NoSQL; Blob Storage for application data; Function host/deployment storage; and Log Analytics/Application Insights.
- The Functions app runs Node.js 22, has a system-assigned managed identity, and uses outbound VNet integration to reach private endpoints for Cosmos DB and the data Blob Storage account. Both data services have public network access disabled. Cosmos DB local/key authentication is disabled; the app identity has Cosmos DB data-plane and Blob data roles. Function host storage uses identity-based authentication and has separate role assignments.
- Cosmos DB is configured for the Free Tier, with a shared-throughput database at 400 RU/s and an account throughput cap of 1,000 RU/s. Free Tier eligibility is limited to one account per subscription and covers up to 1,000 RU/s and 25 GB of storage.
- `infra/environments/dev.bicepparam`: development parameters for `main.bicep`, including the Japan East location and `dev` tag.
- `src/frontend/`: static site files. `index.html` is the Japanese-language sample page. `staticwebapp.config.json` currently sets `apiRuntime` to `node:20`; that setting applies to Static Web Apps managed Functions and does not select the runtime of the linked BYOF API.
- `src/api/`: Azure Functions v4 API, built with TypeScript and configured for Node.js 22. HTTP handlers are under `src/functions/`, and `jobs.ts` contains a timer-triggered function.
- `.github/workflows/deploy.yml`: path-filtered Bicep validation, Azure infrastructure deployment, Function App build/deployment, and frontend upload to the Blob static website.

There is no root package manifest. The API's `package.json` and `tsconfig.json` are the source of truth for its build configuration. The workflow runs `npm run build` in `src/api` and deploys the Function App package.

## Working conventions

- Keep infrastructure changes in Bicep and environment-specific values in `infra/environments/*.bicepparam`. Preserve the resource-group deployment scope unless the architecture is intentionally changed.
- Keep frontend assets in `src/frontend/` and API handlers in `src/api/src/functions/`. The frontend calls APIs through the `/api/...` path on the same Static Web App host.
- Keep the Azure Functions runtime at Node.js 22 in `src/api/package.json` and `infra/main.bicep` unless a deliberate runtime change updates both application configuration and deployment assumptions. The `apiRuntime` setting in `staticwebapp.config.json` only applies if the project switches back to managed Functions.
- Keep `location` in `infra/main.bicep` and `infra/environments/dev.bicepparam` consistent with the intended deployment region.
- Treat changes to Azure resource properties, identity permissions, network rules, runtime versions, deployment paths, GitHub permissions, and secret names as coordinated changes. Do not put credential values in source files.
- The workflow validates infrastructure with `az bicep lint`, `az bicep build`, and `az bicep build-params`. Azure deployments use GitHub OIDC credentials (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) and `AZURE_RESOURCE_GROUP`; Static Web Apps deployment uses `AZURE_STATIC_WEB_APPS_API_TOKEN`.
- No test suite or root-level build command is currently defined. Check package scripts and workflow steps before documenting or relying on additional validation commands.

## Change guidance

- Keep names, user-facing copy, and comments consistent with the existing Japanese-language sample unless the requested change calls for another language.
- When adding deployable files or moving code, update `.github/workflows/deploy.yml` paths and build/deployment locations as needed. Its current change filters watch `src/**` and `infra/**`.
- Avoid introducing frameworks, dependencies, or new deployment mechanisms for a small sample change unless they are needed for the requested behavior.
