# PrintQ WebApp

Web implementation of PrintQ aligned to the PrintQ mobile app design and functionality.

## Stack

- React + Vite + TypeScript
- React Router
- socket.io-client for realtime
- Fetch-based API layer (no Axios)

## Project Structure

- src/app: app bootstrap, routing, providers
- src/features: feature pages and feature state
- src/services/api: fetch client and domain API modules
- src/services/realtime: socket connectors
- src/services/storage: token/session storage
- src/shared: shared UI, theme, and types

## Environment

Create .env from .env.example:

```
VITE_API_BASE_URL=http://localhost:3000/api/v1
VITE_WS_BASE_URL=http://localhost:3000
VITE_AUTH_ACCESS_TOKEN_KEY=printq_access_token
VITE_AUTH_REFRESH_TOKEN_KEY=printq_refresh_token
```

## Commands

- npm run dev: run Vite dev server
- npm run lint: lint project
- npm run test: run unit tests
- npm run build: create production build

## Current Parity Coverage

- Auth flows: login/register/forgot/reset with validation and loading states
- Home: all shops, near me, search, live shop status, offline guard
- Print: step-based flow, upload validation, pricing breakdown, job creation
- Orders: timeline UI, queue enrichment, realtime updates + polling
- Notifications: live feed updates, single/all read actions, socket status
- Profile: labeled fields and sign-out action

See PARITY_TRACKER.md for implemented and remaining details.

## Release Checklist

1. Environment

- .env values point to intended backend and ws hosts
- backend routes available under /api/v1

2. Quality gates

- npm run lint passes
- npm run test passes
- npm run build passes

3. Manual smoke test

- auth: login/register/forgot/reset
- home: all shops/nearby/search and offline select guard
- print: upload valid file and create job
- orders: timeline and queue info appears
- notifications: mark single and mark all read

4. Deployment notes

- Serve dist output behind HTTPS
- Configure API and WS origins/CORS for deployment domain
- Validate websocket connectivity in production network

## Constraint

This project intentionally uses fetch for all HTTP requests.
Do not introduce Axios.
# printpe_webApp
