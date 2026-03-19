# Lunelia Esthetics - Booking & Payment System

A full-featured website for esthetics services with appointment booking and Stripe payment integration.

## Features

✓ Browse services by category (Waxing, Facials, Chemical Peels, etc.)
✓ Add services to cart
✓ Schedule appointments with real-time availability
✓ Collect customer information (name, email, phone)
✓ Process secure payments with Stripe
✓ Send confirmation emails to customers
✓ Manage bookings in PostgreSQL database
✓ 20-minute buffer between appointments

## Tech Stack

- **Frontend:** HTML, CSS, JavaScript
- **Backend:** Node.js, Express.js
- **Database:** PostgreSQL
- **Payments:** Stripe
- **Email:** Nodemailer

## Setup Instructions

### 1. Install Node.js (if not already installed)

Download from: https://nodejs.org/

### 2. Clone or Download This Project

```bash
cd /path/to/luneliaesthetics
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Create a `.env` File

Copy the template and add your actual keys:

```bash
cp .env.example .env
```

Then edit `.env` and add:

#### Stripe Keys:
1. Go to https://dashboard.stripe.com/apikeys
2. Copy your **Publishable Key** and **Secret Key**
3. Paste into `.env`:
```
STRIPE_PUBLIC_KEY=pk_test_your_key
STRIPE_SECRET_KEY=sk_test_your_key
```

#### Gmail Configuration:
1. Use your Gmail email address
2. Generate an [App Password](https://myaccount.google.com/apppasswords) (if 2FA is enabled)
3. Add to `.env`:
```
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

#### PostgreSQL Database:
Set your `DATABASE_URL` in `.env` (example):
```
DATABASE_URL=postgres://user:password@localhost:5432/lunelia
```

#### Admin Dashboard:
Set admin credentials in `.env` to access `/admin.html`:
```
ADMIN_USER=admin
ADMIN_PASS_HASH=replace-with-scrypt-hash
ADMIN_RATE_LIMIT_WINDOW_MS=900000
ADMIN_RATE_LIMIT_MAX=100
```

`ADMIN_PASS_HASH` is preferred. `ADMIN_PASS` still works as a legacy fallback for local development, but should not be used in production.

#### Client Session Security:
Set a strong random secret (32+ chars recommended):
```
CLIENT_TOKEN_SECRET=replace-with-a-random-64-character-secret
```

### 5. Run the Server

```bash
npm start
```

You should see:
```
✓ Server running on http://localhost:3000
```

### 7. Open in Browser

Go to: **http://localhost:3000**

## File Structure

```
luneliaesthetics/
├── index.html          # Main services page
├── booking.html        # Appointment booking page
├── success.html        # Payment confirmation page
├── admin.html          # Admin booking dashboard
├── admin.js            # Admin dashboard logic
├── script.js           # Services & cart logic
├── booking.js          # Booking & Stripe integration
├── server.js           # Express backend
├── styles.css          # All styling
├── package.json        # Dependencies
├── .env.example        # Environment template
├── .env               # Your actual keys (never commit)
```

## How It Works

1. **Browse Services** - Customer views all services on index.html
2. **Add to Cart** - Click "Add to Cart" for desired services
3. **Checkout** - Click "Checkout" to go to booking.html
4. **Fill Form** - Enter name, email, phone, select date & time
5. **Enter Card** - Stripe card element collects payment info
6. **Submit** - Creates Stripe checkout session
7. **Stripe Payment** - Customer completes payment on Stripe
8. **Confirmation** - Email sent automatically, booking saved to database
9. **Success Page** - Customer sees confirmation message

## API Endpoints

### GET `/api/appointments?date=YYYY-MM-DD`
Fetch booked times for a specific date

**Response:**
```json
[
  { "time": "09:00" },
  { "time": "10:00" }
]
```

### POST `/api/create-payment-intent`
Create Stripe checkout session

**Request:**
```json
{
  "amount": 1800,
  "date": "2026-02-25",
  "time": "14:00",
  "services": [{"name": "Facial Waxing", "price": 18}],
  "customer": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "555-1234",
    "timezone": "America/New_York"
  }
}
```

**Response:**
```json
{ "sessionId": "cs_test_..." }
```

### POST `/api/confirm-booking`
Confirm appointment after payment

**Request:**
```json
{
  "sessionId": "cs_test_..."
}
```

### GET `/api/admin/appointments`
List all appointments (basic auth required)

### POST `/api/admin/appointments/:id/cancel`
Cancel an appointment (basic auth required)

### GET `/api/client/session`
Return current signed-in client (cookie session required)

### POST `/api/client/logout`
Clear client session cookie (cookie session + CSRF header required)

## Testing

### Test Card Numbers (Stripe)
- Success: `4242 4242 4242 4242`
- Decline: `4000 0000 0000 0002`
- Expiry: Any future date
- CVC: Any 3 digits

## Development

### Using Nodemon (auto-restart on file changes)

```bash
npm run dev
```

### Viewing Database

Connect to PostgreSQL and query appointments:

```sql
SELECT * FROM appointments ORDER BY created_at DESC;
```

## Troubleshooting

### "Cannot find module..." error
Run: `npm install`

### No emails being sent
- Check `.env` file has correct EMAIL credentials
- Verify Gmail App Password is generated
- Check spam folder for test emails

### Stripe errors
- Check `STRIPE_PUBLIC_KEY`, `STRIPE_SECRET_KEY`, and `STRIPE_WEBHOOK_SECRET` in `.env`
- Use test keys (start with `pk_test_` and `sk_test_`)

## Security Operations Checklist

- Run `npm audit` before each deploy and patch high/critical findings.
- Monitor server logs for repeated 401/403/409 patterns and payment/webhook failures.
- Use least-privilege DB credentials (application user should not be superuser).
- Back up PostgreSQL on a schedule and test restore at least monthly.
- Rotate secrets (`STRIPE_SECRET_KEY`, `EMAIL_PASS`, `CLIENT_TOKEN_SECRET`, admin creds) on a regular cadence.
- Keep admin throttling tight with `ADMIN_RATE_LIMIT_WINDOW_MS` and `ADMIN_RATE_LIMIT_MAX`, especially before production.
- Schedule periodic security testing (automated scans + manual penetration tests).

## Next Steps (Optional Enhancements)

- [ ] Add SMS reminders (Twilio)
- [ ] Client self-service cancellation
- [ ] Add package/membership options
- [ ] Deploy to production (Render, AWS, etc.)

## License

© 2026 Lunelia Esthetics. All rights reserved.
