# Project context

## Overview

Flyingfish is a small Azure Static Web Apps sample. Azure infrastructure is declared in Bicep, the frontend is static HTML, and the API is implemented with TypeScript on Azure Functions. GitHub Actions deploys infrastructure and the app through separate jobs.

## Repository layout

- `infra/main.bicep`: resource-group-scoped Azure deployment. Creates a Free-tier `Microsoft.Web/staticSites` resource, with East Asia as the default location, staging environments enabled, and public network access enabled.
- `infra/environments/dev.bicepparam`: development parameters for `main.bicep`, including the East Asia location and `dev` tag.
- `src/frontend/`: static site files. `index.html` is the current Japanese-language sample page; `staticwebapp.config.json` selects the `node:20` API runtime.
- `src/api/`: Azure Functions v4 API, built with TypeScript. `src/functions/hello.ts` registers the anonymous `GET /api/hello` endpoint. `host.json` uses Functions extension bundle v4.
- `.github/workflows/deploy.yml`: path-filtered Bicep validation, Azure infrastructure deployment, Static Web Apps app/API deployment, and preview cleanup for closed pull requests.

There is no root package manifest. The API's `package.json` and `tsconfig.json` are the source of truth for its build configuration. The workflow runs `npm run build` in the API deployment context and expects the API build to produce JavaScript under `src/api/dist`.

## Working conventions

- Keep infrastructure changes in Bicep and environment-specific values in `infra/environments/*.bicepparam`. Preserve the resource-group deployment scope unless the architecture is intentionally changed.
- Keep frontend assets in `src/frontend/` and API handlers in `src/api/src/functions/`. The frontend calls APIs through the `/api/...` path on the same Static Web App host.
- Use the existing TypeScript strict compiler settings and the Node.js 20 runtime target for Functions unless a deliberate runtime upgrade updates both application configuration and deployment assumptions.
- When adding deployable files or moving code, update `.github/workflows/deploy.yml` paths and build/deployment locations as needed. Its current change filters watch `src/**` and `infra/**`; infrastructure is deployed on `main` pushes when `infra/**` changes, while app/API deployment is driven by `src/**` changes and pull requests.
- The workflow validates infrastructure with `az bicep lint`, `az bicep build`, and `az bicep build-params`. Azure resource deployment uses GitHub OIDC credentials (`AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`) and `AZURE_RESOURCE_GROUP`; Static Web Apps deployment uses `AZURE_STATIC_WEB_APPS_API_TOKEN`. Do not put credential values in source files.
- No test suite or root-level build command is currently defined. Check package scripts and workflow steps before documenting or relying on additional validation commands.

## Change guidance

- Keep names, user-facing copy, and comments consistent with the existing Japanese-language sample unless the requested change calls for another language.
- Treat changes to Azure resource properties, runtime versions, deployment paths, GitHub permissions, and secret names as coordinated changes: inspect the Bicep, app configuration, and workflow together.
- Avoid introducing frameworks, dependencies, or new deployment mechanisms for a small sample change unless they are needed for the requested behavior.
