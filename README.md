# Lunelia Esthetics

Lunelia Esthetics is a full-stack booking and client management app for an esthetics business. The project combines static frontend pages with an Express API and PostgreSQL backend to handle booking, payments, client accounts, password recovery, wax pass memberships, and the admin dashboard.

## What the app does

- Displays services and public marketing pages
- Lets clients book appointments with date and time validation
- Accepts Stripe checkout for standard appointments and wax pass purchases
- Captures a signed consent step before completing a booking
- Supports client registration, email verification, login, and password reset
- Provides a client portal for upcoming and past appointments
- Tracks wax pass credits and allows booking eligible services against remaining credits
- Gives admins access to bookings, clients, expenses, finance reporting, analytics, and wax pass management
- Creates and upgrades the required PostgreSQL schema automatically at startup

## Tech stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js and Express
- Database: PostgreSQL
- Payments: Stripe
- Email: SendGrid via the `@sendgrid/mail` package
- Security: Helmet, signed session cookies, CSRF checks, rate limiting, and HTTPS enforcement in production

## Important project files

- [server.js](server.js) — Express app, routes, auth, database setup, Stripe logic, and email dispatch
- [serviceData.js](serviceData.js) — shared service catalog and duration data
- [index.html](index.html) — main public landing page
- [booking.html](booking.html) — standard appointment checkout flow
- [consent.html](consent.html) — signed consent page
- [create-account.html](create-account.html) — client registration
- [client-login.html](client-login.html) — client sign-in
- [reset-password.html](reset-password.html) — request/reset password flow
- [verify-email.html](verify-email.html) — email verification page
- [wax-pass.html](wax-pass.html) — wax pass storefront
- [wax-pass-booking.html](wax-pass-booking.html) — wax pass booking flow
- [client.html](client.html) — client portal
- [admin.html](admin.html) — admin dashboard
- [styles.css](styles.css) — shared styling
- [package.json](package.json) — scripts and dependencies
- [.env.example](.env.example) — base environment template

## Requirements

Before running the site locally, you need:

- Node.js 18 or newer
- npm
- PostgreSQL
- A Stripe account with publishable and secret keys
- A SendGrid API key and verified sender email for transactional mail

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Then fill in the real values for your environment in [.env](.env).

## Environment variables

The current app expects the following environment values.

### Required

- `DATABASE_URL` — PostgreSQL connection string
- `CLIENT_TOKEN_SECRET` — strong secret for client session signing; at least 32 characters recommended
- `ADMIN_USER` — admin username
- `ADMIN_PASS_HASH` — hashed admin password for the admin login flow
- `STRIPE_PUBLIC_KEY` — Stripe publishable key
- `STRIPE_SECRET_KEY` — Stripe secret key
- `SENDGRID_API_KEY` — SendGrid API key for email delivery
- `EMAIL_FROM` — sender address used for email messages

### Recommended or commonly used

- `ADMIN_TOKEN_SECRET` — separate admin session secret; if omitted, the app falls back to `CLIENT_TOKEN_SECRET`
- `STRIPE_WEBHOOK_SECRET` — required for webhook verification when using Stripe webhook callbacks
- `PORT` — server port; defaults to `3000`
- `NODE_ENV` — set to `production` outside local development
- `FRONTEND_URL` or `DOMAIN` — public base URL used for redirect and callback links
- `CORS_ORIGIN` — comma-separated allowed origins for cross-origin requests when needed
- `DB_SSL` — set to `true` when your PostgreSQL host requires SSL
- `DB_SSL_REJECT_UNAUTHORIZED` — use `false` for self-signed local PostgreSQL certificates when necessary
- `ADMIN_RATE_LIMIT_WINDOW_MS` — admin rate-limit window in milliseconds
- `ADMIN_RATE_LIMIT_MAX` — max admin requests per window
- `API_RATE_LIMIT_WINDOW_MS` — general API rate-limit window in milliseconds
- `API_RATE_LIMIT_MAX` — max general API requests per window

> The older Gmail/SMTP variables are not the primary mail setup in the current code; the server uses SendGrid by default.

## Database initialization

The app bootstraps and upgrades its database automatically on startup. It creates and migrates tables such as:

- `appointments`
- `payments`
- `clients`
- `expenses`
- `wax_passes`

It also adds missing columns and indexes when the schema needs to be updated.

## Running locally

Start the server:

```bash
npm start
```

Run with automatic restarts during development:

```bash
npm run dev
```

The app listens on the value in `PORT` from your environment, or `3000` by default.

## Public pages and protected routes

### Public pages

- `/`
- [about.html](about.html)
- [contact.html](contact.html)
- [specials.html](specials.html)
- [booking.html](booking.html)
- [consent.html](consent.html)
- [create-account.html](create-account.html)
- [client-login.html](client-login.html)
- [admin-login.html](admin-login.html)
- [reset-password.html](reset-password.html)
- [verify-email.html](verify-email.html)
- [wax-pass.html](wax-pass.html)
- [wax-pass-booking.html](wax-pass-booking.html)

### Protected pages

- `/client` and `/client.html`
- `/admin` and `/admin.html`
- `/wax-pass-booking` and `/wax-pass-booking.html`

Protected pages redirect unauthenticated users back to the matching login flow.

## Authentication and account flows

### Client authentication

Clients can:

- create an account
- verify their email address
- sign in with a session cookie
- reset their password
- view upcoming and past appointments from the client portal
- access wax pass balance and booking history

### Admin authentication

Admins sign in through [admin-login.html](admin-login.html). After login, the server issues an admin session cookie and checks it on protected admin pages and admin API routes.

## Booking and payment behavior

- Standard appointments are processed with Stripe checkout
- Wax passes are sold as prepaid credit packages
- Wax pass holders can book eligible services against remaining credit balance
- Appointment overlap and duration checks are enforced before confirmation
- Signed consent is required on the booking flow before a reservation is created

## Email behavior

When `SENDGRID_API_KEY` and `EMAIL_FROM` are configured, the app sends emails for:

- booking confirmations
- wax pass purchase confirmations
- client verification emails
- password reset flows
- internal booking notifications

If those values are missing, the app may still run, but mail-based flows will not complete successfully.

## Security

- Helmet hardens HTTP headers
- Client and admin sessions are signed and cookie-based
- Mutating routes require CSRF validation
- Admin and general API routes are both rate limited
- The server redirects insecure HTTP traffic to HTTPS in production

## Development notes

- There is no frontend build step or framework; the app serves static files directly through Express
- [serviceData.js](serviceData.js) is the single shared source for service definitions used by both the frontend and backend
- Database schema initialization is automatic, so local setup is mostly about the environment and PostgreSQL connection

## Troubleshooting

### The app does not start

- Run `npm install`
- Verify PostgreSQL is running and reachable
- Make sure `DATABASE_URL` is set correctly
- Confirm `CLIENT_TOKEN_SECRET` is present and strong enough
- Check your Stripe credentials and SendGrid credentials in [.env](.env)

### The admin page redirects to login

That is expected until a valid admin session is created.

### Emails are not sending

- Verify `SENDGRID_API_KEY` and `EMAIL_FROM`
- Check the server logs for a mail transport error
- Confirm your sender address is verified in SendGrid

### Stripe checkout is failing

- Verify `STRIPE_PUBLIC_KEY` and `STRIPE_SECRET_KEY`
- If webhook-based confirmation is used, confirm `STRIPE_WEBHOOK_SECRET`
- Make sure the configured public app URL matches your Stripe settings

## Scripts

- `npm start` — start the production-style server
- `npm run dev` — start the server with `nodemon` for local development

## License

Private business project for Lunelia Esthetics.
