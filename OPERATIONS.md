# LearnLink Operations Checklist

This file lists the credentials, IDs, URLs, and deployment settings required to run LearnLink as a fully operational platform.

## Required Core Runtime

| Variable | Required For | Notes |
|---|---|---|
| `DATABASE_URL` | All backend services | PostgreSQL connection string. Required for persisted users, sessions, posts, courses, jobs, channels, logs, and flags. |
| `JWT_SECRET` | Gateway/auth | Use a long random secret in production. Local dev currently uses opaque local tokens. |
| `GATEWAY_PORT` | Gateway | Local default: `4000`. |
| `COMMUNITY_PORT` | Community service | Local default: `4100`. |
| `COURSES_PORT` | Courses service | Local default: `4200`. |
| `JOBS_PORT` | Jobs service | Local default: `4300`. |
| `AGENTS_PORT` | Agent service | Local default: `5005`. |
| `COMMUNITY_SERVICE_URL` | Gateway routing | Deployed community service URL. |
| `COURSES_SERVICE_URL` | Gateway routing | Deployed courses service URL. |
| `JOBS_SERVICE_URL` | Gateway routing | Deployed jobs service URL. |
| `AGENTS_SERVICE_URL` | Gateway/domain services | Deployed agent service URL. |

## Frontend

| Variable | Required For |
|---|---|
| `NEXT_PUBLIC_GATEWAY_URL` | Frontend API calls through gateway |
| `NEXT_PUBLIC_COMMUNITY_SERVICE_URL` | Optional direct community-service calls |
| `NEXT_PUBLIC_COURSES_SERVICE_URL` | Optional direct course-service calls |
| `NEXT_PUBLIC_JOBS_SERVICE_URL` | Optional direct job-service calls |

## Gemini / AI Agents

| Variable | Required For |
|---|---|
| `GEMINI_API_KEY` | All required Gemini-backed agents |
| `GOOGLE_CLOUD_PROJECT` | GCP logging/deploy integration |
| `GOOGLE_APPLICATION_CREDENTIALS` or Workload Identity | GCP service access |

## Stripe

| Variable | Required For |
|---|---|
| `STRIPE_SECRET_KEY` | Payments, subscriptions, Connect |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `STRIPE_CONNECT_CLIENT_ID` | Channel-owner Connect onboarding |
| `STRIPE_PRICE_PREMIUM_PROFILE` | Premium profile subscription |
| `STRIPE_PRICE_CHANNEL_MONTHLY` | Paid channel subscriptions |
| `STRIPE_PRICE_JOB_POST` | Recruiter job-post fees |

## Firebase / Notifications

| Variable | Required For |
|---|---|
| `FIREBASE_PROJECT_ID` | FCM project |
| `FCM_SERVER_KEY` or Firebase Admin credentials | Push notifications |
| `FIREBASE_CLIENT_EMAIL` | Firebase Admin SDK service account |
| `FIREBASE_PRIVATE_KEY` | Firebase Admin SDK service account |

## Email and SMS

| Variable | Required For |
|---|---|
| `SMTP_HOST` | Email delivery |
| `SMTP_PORT` | Email delivery |
| `SMTP_USER` | Email delivery |
| `SMTP_PASSWORD` | Email delivery |
| `SMS_PROVIDER_API_KEY` | Teacher live-class SMS reminders |

## Video Hosting

Choose one provider for the current third-party video-hosting path.

| Variable | Required For |
|---|---|
| `MUX_TOKEN_ID` and `MUX_TOKEN_SECRET` | Mux video uploads |
| `BUNNY_API_KEY` and `BUNNY_LIBRARY_ID` | Bunny Stream uploads |
| `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_STREAM_TOKEN` | Cloudflare Stream uploads |

## Feature Flags

| Variable | Default |
|---|---|
| `FF_SELF_HOST_VIDEO` | `true` |
| `FF_PREMIUM_KEY_POINTS` | `true` |
| `FF_LIVE_QUIZ_GRADING` | `true` |
| `FF_CHANNEL_CREATION_AUTO` | `true` |
| `ACTIVITY_SCORE_THRESHOLD` | `0.65` |

## Local Persistence

Run the local stack with JSON persistence:

```bash
node local-dev-stack.mjs
```

Run the local stack with PostgreSQL persistence:

```bash
npm install
$env:DATABASE_URL="postgresql://learnlink:learnlink@localhost:5432/learnlink"
node local-dev-stack.mjs
```

When PostgreSQL is configured, `local-dev-stack.mjs` uses the database tables from `postgres/schema.sql`. Without PostgreSQL, it writes records to `local-dev-data.json`.

## Deployment Recommendation

- Vercel: deploy `learnlink-frontend`.
- GCP Cloud Run: deploy gateway, community, courses, jobs, and agents.
- GCP Cloud SQL PostgreSQL: host the database.
- Firebase: FCM notifications.
- Stripe: payment and subscription webhooks routed through the gateway.

