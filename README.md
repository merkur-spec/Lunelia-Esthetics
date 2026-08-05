# Lunelia Esthetics

Lunelia Esthetics is a full-stack booking website for an esthetics business. The project combines a static HTML/CSS/JavaScript frontend with an Express server, PostgreSQL storage, Stripe checkout, email notifications, client accounts, wax pass support, and an authenticated admin dashboard.

## What this app does

- Displays service offerings and business pages
- Lets clients book appointments with live availability checks
- Processes payments through Stripe
- Captures signed consent during booking
- Supports client account creation, login, email verification, and password reset
- Provides a client portal for appointments and wax passes
- Supports wax pass purchases and credit redemption
- Provides an authenticated admin dashboard for appointments, wax passes, expenses, and analytics
- Persists data in PostgreSQL and applies startup schema updates automatically

## Tech stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js and Express
- Database: PostgreSQL
- Payments: Stripe
- Email: Nodemailer
- Security: Helmet, signed cookie sessions, CSRF protection, and rate limiting

## Important files

- [index.html](index.html) — main public page
- [booking.html](booking.html) — regular appointment checkout flow
- [wax-pass.html](wax-pass.html) — wax pass storefront
- [wax-pass-booking.html](wax-pass-booking.html) — wax pass booking flow
- [client.html](client.html) — authenticated client portal
- [admin.html](admin.html) — authenticated admin dashboard
- [server.js](server.js) — API routes, auth, Stripe, email, and database logic
- [serviceData.js](serviceData.js) — service catalog and duration data
- [styles.css](styles.css) — site styling
- [package.json](package.json) — npm scripts and dependencies
- [.env.example](.env.example) — environment template

## Requirements

Install these before running locally:

- Node.js 18 or newer
- npm
- PostgreSQL
- Stripe account and API keys
- Email credentials if you want mail-based flows to work

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create your environment file

```bash
cp .env.example .env
```

Then fill in your real values in [.env](.env).

## Environment variables

### Required

- `DATABASE_URL` — PostgreSQL connection string
- `STRIPE_PUBLIC_KEY` — Stripe publishable key
- `STRIPE_SECRET_KEY` — Stripe secret key
- `CLIENT_TOKEN_SECRET` — strong random secret for client sessions
- `ADMIN_USER` — admin username
- `ADMIN_PASS_HASH` or `ADMIN_PASS` — admin credential

### Recommended

- `ADMIN_TOKEN_SECRET` — separate strong random secret for admin sessions
- `STRIPE_WEBHOOK_SECRET` — needed for webhook-based Stripe flows
- `RESEND_API_KEY` — Resend API key for production email delivery
- `RESEND_FROM` — verified sender for Resend (or use `EMAIL_FROM`)
- `SMTP_HOST` — SMTP host (optional alternative to Gmail)
- `SMTP_PORT` — SMTP port (typically `587` or `465`)
- `SMTP_SECURE` — `true` for TLS/465, `false` for STARTTLS/587
- `SMTP_USER` — SMTP username/login
- `SMTP_PASS` — SMTP password
- `EMAIL_USER` — Gmail sender account (fallback/local option)
- `EMAIL_PASS` — Gmail app password or fallback SMTP password
- `EMAIL_FROM` — optional branded sender address
- `INTERNAL_NOTIFICATION_EMAIL` — inbox for internal booking alerts
- `PORT` — local or deployed server port
- `NODE_ENV` — `production` outside local development
- `DOMAIN` or `FRONTEND_URL` — public application URL
- `CORS_ORIGIN` — allowed origins when needed
- `DB_SSL` — set to `true` when your PostgreSQL host requires SSL
- `ADMIN_RATE_LIMIT_WINDOW_MS` — admin throttle window
- `ADMIN_RATE_LIMIT_MAX` — admin throttle request cap

Use [.env.example](.env.example) as the template.

## Database initialization

The server creates and updates its core tables automatically on startup. That currently includes:

- `appointments`
- `payments`
- `clients`
- `expenses`
- `wax_passes`

It also applies additive migrations for new columns and indexes when they are missing.

## Running locally

Start the app:

```bash
npm start
```

Run with auto-reload during development:

```bash
npm run dev
```

The server uses the `PORT` value from [.env](.env). If `PORT` is not set, it defaults to `3000`.

## Routes

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

Protected pages redirect unauthenticated users to their matching login page.

## Authentication

### Client authentication

Clients can:

- create accounts
- verify their email
- sign in
- reset their password
- access the client portal through a session cookie

### Admin authentication

Admins sign in through [admin-login.html](admin-login.html). After successful login, the server issues an admin session cookie. Protected admin pages and admin API routes require that session.

## Booking and payment behavior

- Standard appointments are paid through Stripe
- Wax passes are sold as credit packages
- Wax pass holders can book eligible services against remaining credits
- Scheduling conflicts are checked using appointment overlap and stored durations
- Signed consent is required during booking flows

## Email behavior

When email credentials are configured, the app can send messages for:

- booking confirmations
- wax pass purchase confirmations
- verification emails
- password reset flows

If email credentials are missing, those mail-based features may not work.

## Security

- Helmet sets security-related HTTP headers
- Client and admin auth use signed token cookies
- Mutating routes use CSRF validation
- Admin API routes use their own rate limiter
- General API routes are rate-limited separately
- Production traffic is redirected to HTTPS

## Development notes

- There is no frontend build system or framework
- Static assets are served directly by Express
- [serviceData.js](serviceData.js) is the shared service catalog used by both frontend and backend logic

## Troubleshooting

### The app does not start

- Run `npm install`
- Make sure PostgreSQL is running
- Verify `DATABASE_URL`
- Verify your Stripe keys exist
- Verify `CLIENT_TOKEN_SECRET` is set and sufficiently long

### The admin page redirects to login

That is expected unless you already have a valid admin session.

### Emails are not sending

- Preferred production setup: configure `RESEND_API_KEY` and `RESEND_FROM`
- If using SMTP, verify `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, and `SMTP_PASS`
- If using Gmail fallback, verify `EMAIL_USER` and `EMAIL_PASS` (app password)
- Check server logs for mail transport errors

### Stripe checkout is failing

- Verify `STRIPE_PUBLIC_KEY` and `STRIPE_SECRET_KEY`
- Verify `STRIPE_WEBHOOK_SECRET` if you rely on webhook confirmation
- Make sure your configured public URL matches your Stripe settings

## Scripts

- `npm start` — start the server
- `npm run dev` — start the server with `nodemon`

## License

Private business project for Lunelia Esthetics.
