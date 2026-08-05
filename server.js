require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const dns = require("dns");
const path = require("path");
const crypto = require("crypto");
const { serviceData } = require("./serviceData");

if (typeof dns.setDefaultResultOrder === "function") {
    dns.setDefaultResultOrder("ipv4first");
}

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = "/api/webhook";
const jsonParser = express.json({ limit: "1mb" });
const CLIENT_TOKEN_SECRET = String(process.env.CLIENT_TOKEN_SECRET || "").trim();
const ADMIN_TOKEN_SECRET = String(process.env.ADMIN_TOKEN_SECRET || CLIENT_TOKEN_SECRET).trim();
const PUBLIC_APP_URL = String(
    process.env.FRONTEND_URL || process.env.DOMAIN || "http://localhost:3001"
)
    .trim()
    .replace(/\/+$/, "");
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const CLIENT_SESSION_COOKIE = "clientSession";
const CLIENT_CSRF_COOKIE = "clientCsrf";
const CLIENT_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const CLIENT_IDLE_TIMEOUT_MS = 1000 * 60 * 30;
const ADMIN_SESSION_COOKIE = "adminSession";
const ADMIN_CSRF_COOKIE = "adminCsrf";
const ADMIN_SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 12;
const ADMIN_IDLE_TIMEOUT_MS = 1000 * 60 * 30;
const ADMIN_RATE_LIMIT_WINDOW_MS = parsePositiveIntEnv(
    "ADMIN_RATE_LIMIT_WINDOW_MS",
    15 * 60 * 1000
);
const ADMIN_RATE_LIMIT_MAX = parsePositiveIntEnv("ADMIN_RATE_LIMIT_MAX", 100);
const API_RATE_LIMIT_WINDOW_MS = parsePositiveIntEnv(
    "API_RATE_LIMIT_WINDOW_MS",
    15 * 60 * 1000
);
const API_RATE_LIMIT_MAX = parsePositiveIntEnv("API_RATE_LIMIT_MAX", 300);

if (!CLIENT_TOKEN_SECRET || CLIENT_TOKEN_SECRET.length < 32) {
    throw new Error("CLIENT_TOKEN_SECRET must be set and at least 32 characters long");
}

function sendInternalError(res, logLabel, error) {
    console.error(logLabel, error);
    return res.status(500).json({ error: "Internal server error" });
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

function parsePositiveIntEnv(name, fallback) {
    const raw = String(process.env[name] || "").trim();

    if (!raw) {
        return fallback;
    }

    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use((req, res, next) => {
    if (process.env.NODE_ENV !== "production") {
        return next();
    }

    const forwardedProto = (req.headers["x-forwarded-proto"] || "")
        .toString()
        .split(",")[0]
        .trim();

    if (req.secure || forwardedProto === "https") {
        return next();
    }

    if (req.method === "GET" || req.method === "HEAD") {
        if (!req.headers.host) {
            return res.status(400).json({ error: "HTTPS is required" });
        }

        return res.redirect(301, `https://${req.headers.host}${req.originalUrl}`);
    }

    return res.status(400).json({ error: "HTTPS is required" });
});

const corsOrigins = (process.env.CORS_ORIGIN || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedCorsOrigins = new Set(corsOrigins);

if (!IS_PRODUCTION) {
    [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3001",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3001"
    ].forEach((origin) => allowedCorsOrigins.add(origin));

    allowedCorsOrigins.add(`http://localhost:${PORT}`);
    allowedCorsOrigins.add(`http://127.0.0.1:${PORT}`);
}

if (allowedCorsOrigins.size > 0) {
    app.use(
        cors({
            origin(origin, callback) {
                if (!origin || allowedCorsOrigins.has(origin)) {
                    return callback(null, true);
                }

                return callback(new Error("Not allowed by CORS"));
            },
            credentials: true
        })
    );
}

app.use(
    helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                scriptSrc: ["'self'", "https://js.stripe.com"],
                styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "https://api.stripe.com"],
                frameSrc: ["'self'", "https://js.stripe.com", "https://checkout.stripe.com"],
                frameAncestors: ["'none'"],
                objectSrc: ["'none'"],
                baseUri: ["'self'"],
                formAction: ["'self'", "https://checkout.stripe.com"],
                upgradeInsecureRequests: []
            }
        },
        crossOriginEmbedderPolicy: false
    })
);
app.use(
    "/api",
    rateLimit({
        windowMs: API_RATE_LIMIT_WINDOW_MS,
        max: API_RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        skip(req) {
            if (req.originalUrl === WEBHOOK_PATH) {
                return true;
            }

            return req.originalUrl.startsWith("/api/admin");
        },
        message: { error: "Too many requests. Please try again later." }
    })
);
app.use(
    "/api/admin",
    rateLimit({
        windowMs: ADMIN_RATE_LIMIT_WINDOW_MS,
        max: ADMIN_RATE_LIMIT_MAX,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: "Too many admin requests. Please try again later." }
    })
);

app.use((req, res, next) => {
    if (req.originalUrl === WEBHOOK_PATH) {
        return next();
    }

    return jsonParser(req, res, next);
});


// Initialize PostgreSQL database
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl:
        process.env.DB_SSL === "true"
            ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== "false" }
            : undefined
});

if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is not set. Database connections will fail.");
}

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

async function withAppointmentLocks(lockKeys, callback) {
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const uniqueKeys = [...new Set((lockKeys || []).filter(Boolean).map((key) => String(key)))].sort();

        for (const key of uniqueKeys) {
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [key]);
        }

        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (error) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Rollback error during appointment lock transaction:", rollbackError);
        }

        throw error;
    } finally {
        client.release();
    }
}

function getAppointmentDateLockKey(date) {
    return date ? `appointments:${String(date).trim()}` : "";
}

async function migrateAppointmentDateTimeColumns() {
    try {
        const columnInfo = await pool.query(
            `
                SELECT column_name, data_type
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'appointments'
                  AND column_name IN ('date', 'time')
            `
        );

        const columnTypes = Object.fromEntries(
            columnInfo.rows.map((row) => [row.column_name, row.data_type])
        );

        const needsDateMigration =
            columnTypes.date === "text" || columnTypes.date === "character varying";
        const needsTimeMigration =
            columnTypes.time === "text" || columnTypes.time === "character varying";

        if (!needsDateMigration && !needsTimeMigration) {
            return;
        }

        const invalidData = await pool.query(
            `
                SELECT COUNT(*)::int AS count
                FROM appointments
                WHERE date::text !~ '^\\d{4}-\\d{2}-\\d{2}$'
                   OR time::text !~ '^\\d{2}:\\d{2}(:\\d{2})?$'
            `
        );

        if ((invalidData.rows[0]?.count || 0) > 0) {
            console.warn(
                "Skipping DATE/TIME migration for appointments because invalid existing values were found."
            );
            return;
        }

        await pool.query("BEGIN");

        if (needsDateMigration) {
            await pool.query(
                "ALTER TABLE appointments ALTER COLUMN date TYPE DATE USING date::date"
            );
        }

        if (needsTimeMigration) {
            await pool.query(
                "ALTER TABLE appointments ALTER COLUMN time TYPE TIME USING time::time"
            );
        }

        await pool.query("COMMIT");
        console.log("Migrated appointments.date/time columns to DATE/TIME");
    } catch (migrationError) {
        try {
            await pool.query("ROLLBACK");
        } catch (rollbackError) {
            console.error("Rollback error during date/time migration:", rollbackError);
        }

        console.error("Date/time migration error:", migrationError);
    }
}

// Create tables if they don't exist
async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS appointments (
                id SERIAL PRIMARY KEY,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                duration_minutes INTEGER,
                services TEXT NOT NULL,
                email TEXT,
                name TEXT,
                phone TEXT,
                price INTEGER,
                stripe_payment_id TEXT,
                timezone TEXT,
                status TEXT DEFAULT 'confirmed',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id SERIAL PRIMARY KEY,
                stripe_session_id TEXT UNIQUE,
                stripe_payment_intent_id TEXT,
                amount INTEGER,
                status TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS clients (
                id SERIAL PRIMARY KEY,
                name TEXT,
                email TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS expenses (
                id SERIAL PRIMARY KEY,
                expense_date DATE NOT NULL,
                category TEXT NOT NULL,
                description TEXT,
                amount_cents INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pool.query(
            "CREATE UNIQUE INDEX IF NOT EXISTS appointments_date_time_unique ON appointments (date, time)"
        );
        await pool.query(
            "CREATE UNIQUE INDEX IF NOT EXISTS appointments_payment_unique ON appointments (stripe_payment_id)"
        );

        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS duration_minutes INTEGER"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS client_id INTEGER REFERENCES clients(id)"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consent_signature TEXT"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS consent_accepted_at TIMESTAMP"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMP"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS cancellation_fee_percent INTEGER DEFAULT 0"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS no_show_fee_percent INTEGER DEFAULT 0"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS referred_by_email TEXT"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS applied_specials TEXT"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS discount_cents INTEGER DEFAULT 0"
        );
        await pool.query(
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS reset_password_token_hash TEXT"
        );
        await pool.query(
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMP"
        );
        await pool.query(
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE"
        );
        await pool.query(
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_verification_token_hash TEXT"
        );
        await pool.query(
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS email_verification_expires_at TIMESTAMP"
        );
        await pool.query(
            `
                UPDATE clients
                SET email_verified = TRUE
                WHERE COALESCE(email_verified, FALSE) = FALSE
                  AND email_verification_token_hash IS NULL
                  AND email_verification_expires_at IS NULL
            `
        );
        await pool.query(
            "UPDATE appointments SET duration_minutes = 30 WHERE duration_minutes IS NULL"
        );

        // ── Wax pass tables ──────────────────────────────────────────────────────
        await pool.query(`
            CREATE TABLE IF NOT EXISTS wax_passes (
                id                  SERIAL PRIMARY KEY,
                client_id           INTEGER NOT NULL REFERENCES clients(id),
                service_id          TEXT NOT NULL,
                service_name        TEXT NOT NULL,
                tier                INTEGER NOT NULL,
                total_credits       INTEGER NOT NULL,
                paid_credits        INTEGER NOT NULL,
                used_credits        INTEGER NOT NULL DEFAULT 0,
                price_paid_cents    INTEGER NOT NULL,
                per_use_price_cents INTEGER NOT NULL,
                stripe_session_id   TEXT,
                stripe_payment_id   TEXT,
                status              TEXT NOT NULL DEFAULT 'active',
                created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS wax_passes_stripe_session_id_unique
             ON wax_passes (stripe_session_id)`
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS wax_pass_id INTEGER REFERENCES wax_passes(id)"
        );
        await pool.query(
            "ALTER TABLE appointments ADD COLUMN IF NOT EXISTS wax_pass_credit_forfeited BOOLEAN NOT NULL DEFAULT FALSE"
        );
        // ────────────────────────────────────────────────────────────────────────

        await migrateAppointmentDateTimeColumns();

        console.log("Connected to PostgreSQL and tables initialized");
    } catch (err) {
        console.error("Database initialization error:", err);
    }
}

// Initialize on startup
initializeDatabase();

const EMAIL_USER = String(process.env.EMAIL_USER || "").trim();
const RAW_EMAIL_PASS = String(process.env.EMAIL_PASS || "").trim();
const EMAIL_PASS = /@gmail\.com$/i.test(EMAIL_USER)
    ? RAW_EMAIL_PASS.replace(/\s+/g, "")
    : RAW_EMAIL_PASS;
const SMTP_HOST = String(process.env.SMTP_HOST || "").trim();
const SMTP_PORT = Number.parseInt(String(process.env.SMTP_PORT || "").trim(), 10) || 587;
const SMTP_SECURE_ENV = String(process.env.SMTP_SECURE || "").trim().toLowerCase();
const SMTP_SECURE = SMTP_SECURE_ENV ? SMTP_SECURE_ENV === "true" : SMTP_PORT === 465;
const SMTP_USER = String(process.env.SMTP_USER || EMAIL_USER).trim();
const RAW_SMTP_PASS = String(process.env.SMTP_PASS || EMAIL_PASS).trim();
const SMTP_PASS = /@gmail\.com$/i.test(SMTP_USER)
    ? RAW_SMTP_PASS.replace(/\s+/g, "")
    : RAW_SMTP_PASS;
const EMAIL_FROM = String(process.env.EMAIL_FROM || SMTP_USER || EMAIL_USER).trim();
const USE_CUSTOM_SMTP = Boolean(SMTP_HOST);

// Setup email transporter (update with your email credentials)
const transporter = USE_CUSTOM_SMTP
    ? nodemailer.createTransport({
          host: SMTP_HOST,
          port: SMTP_PORT,
          secure: SMTP_SECURE,
          auth: {
              user: SMTP_USER,
              pass: SMTP_PASS
          },
          family: 4,
          connectionTimeout: 20000,
          greetingTimeout: 20000,
          socketTimeout: 30000
      })
    : nodemailer.createTransport({
          service: "gmail",
          auth: {
              user: EMAIL_USER,
              pass: EMAIL_PASS
          },
          family: 4,
          connectionTimeout: 20000,
          greetingTimeout: 20000,
          socketTimeout: 30000
      });

async function sendMailWithIPv4Fallback(mailOptions) {
    try {
        return await transporter.sendMail(mailOptions);
    } catch (error) {
        const message = String(error?.message || "");
        const shouldRetryIPv4 =
            !USE_CUSTOM_SMTP && message.includes("ENETUNREACH") && /@gmail\.com$/i.test(EMAIL_USER);

        if (!shouldRetryIPv4) {
            throw error;
        }

        const smtpHost = "smtp.gmail.com";
        const ipv4Addresses = await dns.promises.resolve4(smtpHost);

        if (!Array.isArray(ipv4Addresses) || ipv4Addresses.length === 0) {
            throw error;
        }

        const ipv4Transporter = nodemailer.createTransport({
            host: ipv4Addresses[0],
            port: 465,
            secure: true,
            auth: {
                user: EMAIL_USER,
                pass: EMAIL_PASS
            },
            tls: {
                servername: smtpHost
            },
            connectionTimeout: 20000,
            greetingTimeout: 20000,
            socketTimeout: 30000
        });

        return ipv4Transporter.sendMail(mailOptions);
    }
}

function hasEmailTransportCredentials() {
    if (USE_CUSTOM_SMTP) {
        return Boolean(SMTP_HOST) && Boolean(SMTP_USER) && Boolean(SMTP_PASS);
    }

    return Boolean(EMAIL_USER) && Boolean(EMAIL_PASS);
}

function buildVerificationLink(req, email, rawVerificationToken) {
    const apiOrigin = `${req.protocol}://${req.get("host")}`;
    return `${PUBLIC_APP_URL}/verify-email.html?token=${encodeURIComponent(rawVerificationToken)}&email=${encodeURIComponent(email)}&api=${encodeURIComponent(apiOrigin)}`;
}

async function issueEmailVerificationToken(clientId) {
    const rawVerificationToken = crypto.randomBytes(32).toString("hex");
    const verificationTokenHash = hashResetToken(rawVerificationToken);
    const verificationExpiry = new Date(Date.now() + 1000 * 60 * 60 * 24);

    await pool.query(
        `
            UPDATE clients
            SET email_verification_token_hash = $1,
                email_verification_expires_at = $2,
                email_verified = FALSE
            WHERE id = $3
        `,
        [verificationTokenHash, verificationExpiry, clientId]
    );

    return rawVerificationToken;
}

async function sendVerificationEmail(client, verifyLink) {
    if (!hasEmailTransportCredentials()) {
        throw new Error("Email transport is not configured");
    }

    await sendMailWithIPv4Fallback({
        from: EMAIL_FROM || SMTP_USER || EMAIL_USER,
        to: client.email,
        subject: "Verify Your Lunelia Esthetics Account",
        html: `
            <h2>Welcome to Lunelia Esthetics</h2>
            <p>Hi ${client.name || "there"},</p>
            <p>Your client account has been created successfully.</p>
            <p>Please verify your email before signing in.</p>
            <p><a href="${verifyLink}">Verify your email</a></p>
        `
    });
}

function formatServicesForEmail(services) {
    if (!Array.isArray(services) || services.length === 0) {
        return "-";
    }

    return services
        .map((service) => escapeHtml(String(service?.name || service?.id || "Service").trim()))
        .filter(Boolean)
        .join(", ");
}

async function sendInternalBookingNotification(details = {}) {
    const inbox = String(process.env.EMAIL_USER || "").trim();
    const password = String(process.env.EMAIL_PASS || "").trim();

    if (!inbox || !password) {
        return;
    }

    const appointmentId = Number(details.appointmentId) || "N/A";
    const date = String(details.date || "-").trim();
    const time = String(details.time || "-").trim();
    const clientName = String(details.name || "-").trim();
    const nameParts = clientName.split(/\s+/).filter(Boolean);
    const firstName = nameParts[0] || "-";
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : "-";
    const clientEmail = String(details.email || "-").trim();
    const clientPhone = String(details.phone || "-").trim();
    const source = String(details.source || "booking").trim();
    const bookedAtRaw = String(details.bookedAt || new Date().toISOString()).trim();
    const bookedAtDate = new Date(bookedAtRaw);
    const bookedAt = Number.isNaN(bookedAtDate.getTime())
        ? bookedAtRaw
        : bookedAtDate.toLocaleString(undefined, {
              year: "numeric",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
              timeZone: "America/New_York",
              timeZoneName: "short"
          });
    const consentSignature = String(details.consentSignature || "").trim();
    const services = formatServicesForEmail(details.services);
    const totalPaidCents = Number(details.totalPaidCents);
    const amountLine = Number.isFinite(totalPaidCents)
        ? `<p><strong>Amount:</strong> $${(Math.max(0, totalPaidCents) / 100).toFixed(2)}</p>`
        : "";
    const consentLine = consentSignature
        ? `
            <p><strong>Signed Consent Form:</strong> Yes</p>
            <p><strong>Consent Signature:</strong> ${escapeHtml(consentSignature)}</p>
          `
        : `<p><strong>Signed Consent Form:</strong> No signature captured</p>`;

    await transporter.sendMail({
        from: inbox,
        to: inbox,
        subject: `New Booking Received (${escapeHtml(source)})`,
        html: `
            <h2>New Booking Received</h2>
            <p><strong>Appointment ID:</strong> ${escapeHtml(String(appointmentId))}</p>
            <p><strong>Booked At:</strong> ${escapeHtml(bookedAt)}</p>
            <p><strong>Appointment Date:</strong> ${escapeHtml(date)}</p>
            <p><strong>Appointment Time:</strong> ${escapeHtml(time)}</p>
            <p><strong>Client First Name:</strong> ${escapeHtml(firstName)}</p>
            <p><strong>Client Last Name:</strong> ${escapeHtml(lastName)}</p>
            <p><strong>Email:</strong> ${escapeHtml(clientEmail)}</p>
            <p><strong>Phone:</strong> ${escapeHtml(clientPhone)}</p>
            <p><strong>Service(s) Booked:</strong> ${services}</p>
            ${amountLine}
            ${consentLine}
        `
    });
}

function isValidDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value) {
    return /^\d{2}:\d{2}$/.test(value);
}

function normalizeNameForComparison(value) {
    return String(value || "")
        .trim()
        .toLowerCase()
        .replace(/\s+/g, " ");
}

function signatureMatchesBookingName(signature, bookingName) {
    const normalizedSignature = normalizeNameForComparison(signature);
    const normalizedBookingName = normalizeNameForComparison(bookingName);

    return Boolean(normalizedSignature) && Boolean(normalizedBookingName) && normalizedSignature === normalizedBookingName;
}

function formatDateISO(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function addDays(date, days) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + days);
    return copy;
}

function resolveAnalyticsRange(startRaw, endRaw) {
    const today = new Date();
    const todayIso = formatDateISO(today);

    const end = isValidDate(endRaw || "") ? endRaw : todayIso;
    const defaultStart = formatDateISO(addDays(new Date(end), -29));
    const start = isValidDate(startRaw || "") ? startRaw : defaultStart;

    if (start > end) {
        return null;
    }

    const diffMs = new Date(end).getTime() - new Date(start).getTime();
    const days = Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;

    if (days <= 0 || days > 366) {
        return null;
    }

    return { start, end, days };
}

function clampFeePercent(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
        return 0;
    }

    return Math.min(100, Math.max(0, Math.round(numeric)));
}

function calculateLateCancellationFeePercent(dateText, timeText) {
    const appointmentStart = new Date(`${dateText}T${timeText}:00`);
    const hoursUntil = (appointmentStart.getTime() - Date.now()) / (1000 * 60 * 60);
    return hoursUntil < 24 ? 30 : 0;
}

async function settleAppointmentPolicyWithStripe(appointment, feePercent, reason) {
    const safeFeePercent = clampFeePercent(feePercent);
    const appointmentId = Number(appointment?.id);
    const stripePaymentIntentId = String(appointment?.stripe_payment_id || "").trim();
    const priceCents = Math.max(0, Number(appointment?.price) || 0);

    const baseSettlement = {
        feePercent: safeFeePercent,
        keptCents: Math.round(priceCents * (safeFeePercent / 100)),
        refundedCents: 0,
        hasStripePayment: Boolean(stripePaymentIntentId)
    };

    if (!stripePaymentIntentId || priceCents <= 0) {
        return baseSettlement;
    }

    // Wax-pass appointment tokens are not real Stripe Payment Intents — skip Stripe entirely
    if (!stripePaymentIntentId.startsWith("pi_")) {
        return { ...baseSettlement, hasStripePayment: false };
    }

    const paymentIntent = await stripe.paymentIntents.retrieve(stripePaymentIntentId, {
        expand: ["charges.data.refunds"]
    });

    const capturedCents = Math.max(
        0,
        Number(paymentIntent.amount_received || paymentIntent.amount || 0)
    );

    if (capturedCents <= 0) {
        return {
            ...baseSettlement,
            keptCents: 0
        };
    }

    const totalRefundedCents = (paymentIntent.charges?.data || []).reduce((sum, charge) => {
        return sum + Math.max(0, Number(charge?.amount_refunded) || 0);
    }, 0);

    const targetKeptCents = Math.min(
        capturedCents,
        Math.round(capturedCents * (safeFeePercent / 100))
    );
    const targetRefundedCents = Math.max(0, capturedCents - targetKeptCents);
    const additionalRefundCents = Math.max(0, targetRefundedCents - totalRefundedCents);

    if (additionalRefundCents > 0) {
        await stripe.refunds.create(
            {
                payment_intent: stripePaymentIntentId,
                amount: additionalRefundCents,
                reason: "requested_by_customer",
                metadata: {
                    appointment_id: String(appointmentId || ""),
                    policy_reason: String(reason || "policy")
                }
            },
            {
                idempotencyKey: `policy_refund_${appointmentId || "unknown"}_${safeFeePercent}_${targetRefundedCents}`
            }
        );
    }

    const finalRefundedCents = totalRefundedCents + additionalRefundCents;

    return {
        feePercent: safeFeePercent,
        keptCents: Math.max(0, capturedCents - finalRefundedCents),
        refundedCents: additionalRefundCents,
        hasStripePayment: true
    };
}

function normalizeServiceName(value) {
    return String(value || "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim();
}

const canonicalServicesById = new Map();
const canonicalServicesByName = new Map();

for (const category of Object.values(serviceData || {})) {
    if (!category || !Array.isArray(category.services)) {
        continue;
    }

    for (const service of category.services) {
        if (!service || typeof service.id !== "string" || typeof service.name !== "string") {
            continue;
        }

        const id = service.id.trim();
        const name = service.name.trim();
        const price = Math.round(Number(service.price));
        const duration = Math.round(Number(service.duration));

        if (!id || !name || !Number.isFinite(price) || price <= 0) {
            continue;
        }

        if (!Number.isFinite(duration) || duration <= 0) {
            continue;
        }

        const canonical = { id, name, price, duration };
        canonicalServicesById.set(id, canonical);
        canonicalServicesByName.set(normalizeServiceName(name), canonical);
    }
}

// ─── Wax Pass Tier Definitions ───────────────────────────────────────────────
const WAX_PASS_TIERS = {
    1: { paid: 5, free: 1, total: 6,  label: "Buy 5, Get 1 Free",  discountPct: 16.7 },
    2: { paid: 7, free: 2, total: 9,  label: "Buy 7, Get 2 Free",  discountPct: 22.2 },
    3: { paid: 9, free: 3, total: 12, label: "Buy 9, Get 3 Free",  discountPct: 25.0 }
};

// Services available for Tier 1 & 2
const WAX_PASS_ALL_IDS = [
    "brows", "upper-lip", "lower-lip", "chin", "full-face", "neck", "cheeks",
    "sideburns", "nose", "ears", "hairline",
    "brazilian", "bikini-full", "bikini-line-v", "bikini-line-f",
    "inner-thigh", "full-butt", "butt-strip", "nipples",
    "full-arms", "half-arms", "full-legs", "lower-legs", "upper-legs",
    "underarms", "full-back", "upper-back", "mid-back", "lower-back",
    "chest-full", "chest-strip", "stomach-full", "stomach-strip",
    "hands", "knees", "toes"
];

// Restricted list for Tier 3 only
const WAX_PASS_TIER3_IDS = [
    "brows", "upper-lip", "lower-lip", "chin", "neck", "cheeks",
    "sideburns", "nose", "ears", "hairline",
    "inner-thigh", "butt-strip", "nipples", "stomach-strip",
    "hands", "knees", "toes"
];

function getWaxPassServiceIds(tier) {
    return Number(tier) === 3 ? WAX_PASS_TIER3_IDS : WAX_PASS_ALL_IDS;
}

function buildWaxPassCatalog(tier) {
    const tierDef = WAX_PASS_TIERS[Number(tier)];
    if (!tierDef) { return []; }
    return getWaxPassServiceIds(tier)
        .map((id) => {
            const svc = canonicalServicesById.get(id);
            if (!svc) { return null; }
            const pricePaidCents   = svc.price * 100 * tierDef.paid;
            const perUsePriceCents = Math.round(pricePaidCents / tierDef.total);
            const savingsCents     = svc.price * 100 * tierDef.total - pricePaidCents;
            return {
                id: svc.id,
                name: svc.name,
                price: svc.price,
                fullPriceDollars: svc.price,
                pricePaidCents,
                perUsePriceCents,
                savingsCents
            };
        })
        .filter(Boolean);
}
// ─────────────────────────────────────────────────────────────────────────────

function getServicesTotalDuration(services) {
    return services.reduce((sum, service) => sum + service.duration, 0);
}

async function finalizeWaxPassPurchaseFromSession(session, expectedClientId = null) {
    if (!session || session.payment_status !== "paid") {
        throw new Error("Payment not completed");
    }

    const sessionId = String(session.id || "").trim();
    const meta = session.metadata || {};

    if (meta.type !== "wax_pass_purchase") {
        throw new Error("Invalid session type");
    }

    const clientId = Number(meta.clientId || 0);
    if (!clientId) {
        throw new Error("Missing wax pass client ID");
    }

    if (expectedClientId !== null && Number(expectedClientId) !== clientId) {
        const ownershipError = new Error("Session does not belong to this account");
        ownershipError.statusCode = 403;
        throw ownershipError;
    }

    const existing = await pool.query(
        `SELECT id, service_id, service_name, tier, total_credits, paid_credits,
                used_credits, price_paid_cents, per_use_price_cents, status, created_at
         FROM wax_passes
         WHERE stripe_session_id = $1
         LIMIT 1`,
        [sessionId]
    );

    if (existing.rows.length > 0) {
        return existing.rows[0];
    }

    let inserted;
    try {
        inserted = await pool.query(
            `INSERT INTO wax_passes
                (client_id, service_id, service_name, tier, total_credits, paid_credits,
                 used_credits, price_paid_cents, per_use_price_cents, stripe_session_id,
                 stripe_payment_id, status)
             VALUES ($1,$2,$3,$4,$5,$6,0,$7,$8,$9,$10,'active')
             RETURNING id, service_id, service_name, tier, total_credits, paid_credits,
                       used_credits, price_paid_cents, per_use_price_cents, status, created_at`,
            [
                clientId,
                String(meta.serviceId || "").trim(),
                String(meta.serviceName || "").trim(),
                Number(meta.tier),
                Number(meta.totalCredits),
                Number(meta.paidCredits),
                Number(meta.pricePaidCents),
                Number(meta.perUsePriceCents),
                sessionId,
                session.payment_intent || null
            ]
        );
    } catch (error) {
        if (error?.code !== "23505") {
            throw error;
        }

        inserted = { rows: [] };
    }

    if (inserted.rows.length > 0) {
        return inserted.rows[0];
    }

    const fallback = await pool.query(
        `SELECT id, service_id, service_name, tier, total_credits, paid_credits,
                used_credits, price_paid_cents, per_use_price_cents, status, created_at
         FROM wax_passes
         WHERE stripe_session_id = $1
         LIMIT 1`,
        [sessionId]
    );

    if (fallback.rows.length === 0) {
        throw new Error("Wax pass could not be finalized");
    }

    return fallback.rows[0];
}

function sanitizeServices(services) {
    if (!Array.isArray(services) || services.length === 0) {
        return null;
    }

    const sanitized = services
        .map((service) => {
            if (!service || typeof service !== "object") {
                return null;
            }

            const serviceId = typeof service.id === "string" ? service.id.trim() : "";
            const serviceName = typeof service.name === "string" ? service.name : "";

            let canonical = null;

            if (serviceId) {
                canonical = canonicalServicesById.get(serviceId) || null;
            }

            if (!canonical && serviceName) {
                canonical = canonicalServicesByName.get(normalizeServiceName(serviceName)) || null;
            }

            if (!canonical) {
                return null;
            }

            return {
                id: canonical.id,
                name: canonical.name,
                price: canonical.price,
                duration: canonical.duration
            };
        })
        .filter(Boolean);

    return sanitized.length > 0 ? sanitized : null;
}

/**
 * Returns which promotional specials apply for this email + services + referral.
 * priceOverridesCents: { serviceId: priceInCents } — overrides canonical price for that service
 * flatDiscountCents: total cents to subtract from the final amount
 * isFree: true when a future free-booking promotion applies
 */
async function getApplicableSpecials(email, sanitizedServices, referralEmail, selectedSpecialTypes = null) {
    const selectedTypeSet = Array.isArray(selectedSpecialTypes)
        ? new Set(
            selectedSpecialTypes
                .map((type) => String(type || "").trim())
                .filter(Boolean)
        )
        : null;

    const isSelected = (type) => !selectedTypeSet || selectedTypeSet.has(type);

    const result = {
        specials: [],
        priceOverridesCents: {},
        flatDiscountCents: 0,
        isFree: false
    };

    if (!email || !sanitizedServices || sanitizedServices.length === 0) {
        return result;
    }

    const normalizedEmail = normalizeEmail(email);

    const referralUsedCount = await pool.query(
        `SELECT COUNT(*) FROM appointments
         WHERE LOWER(email) = $1
           AND status IN ('confirmed','late','completed','no_show')
           AND NULLIF(BTRIM(COALESCE(referred_by_email, '')), '') IS NOT NULL`,
        [normalizedEmail]
    );
    const hasUsedReferralBefore = parseInt(referralUsedCount.rows[0].count, 10) > 0;

    // --- Referrer reward check ($15 off for the person who referred someone) ---
    const referralCreditsEarnedCount = await pool.query(
        `SELECT COUNT(*) FROM appointments
         WHERE LOWER(COALESCE(referred_by_email, '')) = $1
           AND status IN ('confirmed','late','completed','no_show')`,
        [normalizedEmail]
    );
    const referralCreditsUsedCount = await pool.query(
        `SELECT COUNT(*) FROM appointments
         WHERE LOWER(email) = $1
           AND status IN ('confirmed','late','completed','no_show')
           AND COALESCE(applied_specials, '') LIKE '%"referrer_credit"%'`,
        [normalizedEmail]
    );
    const referralCreditsAvailable =
        Math.max(
            0,
            parseInt(referralCreditsEarnedCount.rows[0].count, 10) -
                parseInt(referralCreditsUsedCount.rows[0].count, 10)
        );
    if (referralCreditsAvailable > 0 && isSelected("referrer_credit")) {
        result.flatDiscountCents += 1500; // $15.00
        result.specials.push({
            type: "referrer_credit",
            label: "\uD83D\uDC9D Referral Reward: $15 off"
        });
    }

    // --- New client check ---
    const priorCount = await pool.query(
        `SELECT COUNT(*) FROM appointments
         WHERE LOWER(email) = $1 AND status IN ('confirmed','late','completed','no_show')`,
        [normalizedEmail]
    );
    const priorAppointments = parseInt(priorCount.rows[0].count, 10);
    const isNewClient = priorAppointments === 0;

    if (isNewClient) {
        const hasBrazilian = sanitizedServices.some((s) => s.id === "brazilian");
        if (hasBrazilian && isSelected("new_client_brazilian")) {
            result.priceOverridesCents["brazilian"] = 5500; // $55.00
            result.specials.push({ type: "new_client_brazilian", label: "\u2728 New Client Special: First Brazilian — $55" });
        }
        const hasBikini = sanitizedServices.some((s) => s.id === "bikini-full");
        if (hasBikini && isSelected("new_client_bikini")) {
            result.priceOverridesCents["bikini-full"] = 4800; // $48.00
            result.specials.push({ type: "new_client_bikini", label: "\u2728 New Client Special: First Bikini Full — $48" });
        }
    }

    // --- Referral discount ($15 off, one-time per client) ---
    if (referralEmail && !hasUsedReferralBefore) {
        const normalizedReferral = normalizeEmail(referralEmail);
        if (normalizedReferral && normalizedReferral !== normalizedEmail) {
            const referrerExists = await pool.query(
                `SELECT id FROM clients
                 WHERE LOWER(email) = $1
                 LIMIT 1`,
                [normalizedReferral]
            );
            if (referrerExists.rows.length > 0 && isSelected("referral")) {
                result.flatDiscountCents += 1500; // $15.00
                result.specials.push({ type: "referral", label: "\uD83D\uDC9D Referral Discount: $15 off" });
            }
        }
    }

    return result;
}

function getAdminCredentials() {
    return {
        user: process.env.ADMIN_USER || "",
        pass: process.env.ADMIN_PASS || "",
        passHash: process.env.ADMIN_PASS_HASH || ""
    };
}

function validateAdminCredentials(userInput, passInput) {
    const { user, pass, passHash } = getAdminCredentials();
    if (!user || (!passHash && !pass)) {
        return false;
    }

    const isValidUser = timingSafeStringEqual(userInput, user);
    const isValidPassword = passHash
        ? verifyPassword(passInput || "", passHash)
        : timingSafeStringEqual(passInput, pass);

    return isValidUser && isValidPassword;
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return `${salt}:${hash}`;
}

function hashResetToken(token) {
    return crypto.createHash("sha256").update(String(token || "")).digest("hex");
}

function verifyPassword(password, stored) {
    if (!stored || !stored.includes(":")) {
        return false;
    }

    const [salt, originalHash] = stored.split(":");
    if (!salt || !originalHash) {
        return false;
    }

    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    const hashBuffer = Buffer.from(hash, "hex");
    const originalBuffer = Buffer.from(originalHash, "hex");

    if (hashBuffer.length !== originalBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(hashBuffer, originalBuffer);
}

function timingSafeStringEqual(left, right) {
    const leftBuffer = Buffer.from(String(left || ""), "utf8");
    const rightBuffer = Buffer.from(String(right || ""), "utf8");

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function decodeBasicAuthCredentials(authHeader) {
    if (!String(authHeader || "").startsWith("Basic ")) {
        return null;
    }

    try {
        const decoded = Buffer.from(authHeader.replace("Basic ", ""), "base64").toString("utf8");
        const separatorIndex = decoded.indexOf(":");

        if (separatorIndex < 0) {
            return null;
        }

        return {
            user: decoded.slice(0, separatorIndex),
            pass: decoded.slice(separatorIndex + 1)
        };
    } catch (error) {
        return null;
    }
}

function createClientToken(client) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
        JSON.stringify({
            id: client.id,
            email: normalizeEmail(client.email),
            iat: nowSeconds,
            exp: nowSeconds + Math.floor(CLIENT_SESSION_MAX_AGE_MS / 1000)
        })
    ).toString("base64url");

    const signature = crypto
        .createHmac("sha256", CLIENT_TOKEN_SECRET)
        .update(payload)
        .digest("base64url");

    return `${payload}.${signature}`;
}

function createAdminToken(adminUser) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(
        JSON.stringify({
            user: String(adminUser || "").trim(),
            role: "admin",
            iat: nowSeconds,
            exp: nowSeconds + Math.floor(ADMIN_SESSION_MAX_AGE_MS / 1000)
        })
    ).toString("base64url");

    const signature = crypto
        .createHmac("sha256", ADMIN_TOKEN_SECRET)
        .update(payload)
        .digest("base64url");

    return `${payload}.${signature}`;
}

function parseCookies(req) {
    const raw = String(req.headers.cookie || "");
    if (!raw) {
        return {};
    }

    return raw.split(";").reduce((acc, entry) => {
        const separatorIndex = entry.indexOf("=");
        if (separatorIndex <= 0) {
            return acc;
        }

        let key = "";
        let value = "";

        try {
            key = decodeURIComponent(entry.slice(0, separatorIndex).trim());
            value = decodeURIComponent(entry.slice(separatorIndex + 1).trim());
        } catch (error) {
            return acc;
        }

        acc[key] = value;
        return acc;
    }, {});
}

function readCookie(req, cookieName) {
    const cookies = parseCookies(req);
    return String(cookies[cookieName] || "").trim();
}

function buildSessionCookieOptions(httpOnly = true, maxAge = CLIENT_SESSION_MAX_AGE_MS) {
    return {
        httpOnly,
        secure: IS_PRODUCTION,
        sameSite: "lax",
        maxAge,
        path: "/"
    };
}

function attachClientSession(res, client) {
    const token = createClientToken(client);
    const csrfToken = crypto.randomBytes(32).toString("hex");

    res.cookie(CLIENT_SESSION_COOKIE, token, buildSessionCookieOptions(true));
    res.cookie(CLIENT_CSRF_COOKIE, csrfToken, buildSessionCookieOptions(false));
}

function refreshClientSession(res, client) {
    const token = createClientToken(client);
    res.cookie(CLIENT_SESSION_COOKIE, token, buildSessionCookieOptions(true));
}

function attachAdminSession(res, adminUser) {
    const token = createAdminToken(adminUser);
    const csrfToken = crypto.randomBytes(32).toString("hex");

    res.cookie(ADMIN_SESSION_COOKIE, token, buildSessionCookieOptions(true, ADMIN_SESSION_MAX_AGE_MS));
    res.cookie(ADMIN_CSRF_COOKIE, csrfToken, buildSessionCookieOptions(false, ADMIN_SESSION_MAX_AGE_MS));
}

function refreshAdminSession(res, adminUser) {
    const token = createAdminToken(adminUser);
    res.cookie(ADMIN_SESSION_COOKIE, token, buildSessionCookieOptions(true, ADMIN_SESSION_MAX_AGE_MS));
}

function clearClientSession(res) {
    const clearOptions = {
        secure: IS_PRODUCTION,
        sameSite: "lax",
        path: "/"
    };

    res.clearCookie(CLIENT_SESSION_COOKIE, clearOptions);
    res.clearCookie(CLIENT_CSRF_COOKIE, clearOptions);
}

function clearAdminSession(res) {
    const clearOptions = {
        secure: IS_PRODUCTION,
        sameSite: "lax",
        path: "/"
    };

    res.clearCookie(ADMIN_SESSION_COOKIE, clearOptions);
    res.clearCookie(ADMIN_CSRF_COOKIE, clearOptions);
}

function getClientTokenFromRequest(req) {
    const authHeader = req.headers.authorization || "";

    if (authHeader.startsWith("Bearer ")) {
        return authHeader.replace("Bearer ", "").trim();
    }

    return readCookie(req, CLIENT_SESSION_COOKIE);
}

function getAdminTokenFromRequest(req) {
    const authHeader = req.headers.authorization || "";

    if (authHeader.startsWith("Bearer ")) {
        return authHeader.replace("Bearer ", "").trim();
    }

    return readCookie(req, ADMIN_SESSION_COOKIE);
}

function verifyClientToken(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) {
        return null;
    }

    const [payload, signature] = token.split(".");
    const expectedSignature = crypto
        .createHmac("sha256", CLIENT_TOKEN_SECRET)
        .update(payload)
        .digest("base64url");

    const signatureBuffer = Buffer.from(signature, "base64url");
    const expectedBuffer = Buffer.from(expectedSignature, "base64url");

    if (
        signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
        return null;
    }

    try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

        if (!decoded?.email || !decoded?.id || !decoded?.exp) {
            return null;
        }

        if (decoded.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }

        return decoded;
    } catch (error) {
        return null;
    }
}

function verifyAdminToken(token) {
    if (!token || typeof token !== "string" || !token.includes(".")) {
        return null;
    }

    const [payload, signature] = token.split(".");
    const expectedSignature = crypto
        .createHmac("sha256", ADMIN_TOKEN_SECRET)
        .update(payload)
        .digest("base64url");

    const signatureBuffer = Buffer.from(signature, "base64url");
    const expectedBuffer = Buffer.from(expectedSignature, "base64url");

    if (
        signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
    ) {
        return null;
    }

    try {
        const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

        if (!decoded?.user || decoded?.role !== "admin" || !decoded?.exp) {
            return null;
        }

        if (decoded.exp < Math.floor(Date.now() / 1000)) {
            return null;
        }

        return decoded;
    } catch (error) {
        return null;
    }
}

function requireClient(req, res, next) {
    const token = getClientTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ error: "Client authentication required" });
    }
    const payload = verifyClientToken(token);

    if (!payload) {
        clearClientSession(res);
        return res.status(401).json({ error: "Invalid or expired session" });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const issuedAtSeconds = Number(payload.iat);
    const idleAgeSeconds = Number.isFinite(issuedAtSeconds)
        ? nowSeconds - issuedAtSeconds
        : Number.POSITIVE_INFINITY;

    if (idleAgeSeconds > Math.floor(CLIENT_IDLE_TIMEOUT_MS / 1000)) {
        clearClientSession(res);
        return res.status(401).json({ error: "Session expired due to inactivity" });
    }

    if (!String(req.headers.authorization || "").startsWith("Bearer ")) {
        refreshClientSession(res, {
            id: payload.id,
            email: payload.email
        });
    }

    req.clientAuth = payload;
    return next();
}

function getEmptySpecialsResult() {
    return {
        specials: [],
        availableSpecials: [],
        priceOverridesCents: {},
        flatDiscountCents: 0,
        isFree: false
    };
}

function getAuthenticatedClientForRewards(req, res) {
    const token = getClientTokenFromRequest(req);
    if (!token) {
        return null;
    }

    const payload = verifyClientToken(token);
    if (!payload) {
        clearClientSession(res);
        return null;
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const issuedAtSeconds = Number(payload.iat);
    const idleAgeSeconds = Number.isFinite(issuedAtSeconds)
        ? nowSeconds - issuedAtSeconds
        : Number.POSITIVE_INFINITY;

    if (idleAgeSeconds > Math.floor(CLIENT_IDLE_TIMEOUT_MS / 1000)) {
        clearClientSession(res);
        return null;
    }

    if (!String(req.headers.authorization || "").startsWith("Bearer ")) {
        refreshClientSession(res, {
            id: payload.id,
            email: payload.email
        });
    }

    return payload;
}

function requireCsrf(req, res, next) {
    const csrfCookie = readCookie(req, CLIENT_CSRF_COOKIE);
    const csrfHeader = String(req.headers["x-csrf-token"] || "").trim();

    if (!csrfCookie || !csrfHeader) {
        return res.status(403).json({ error: "CSRF token required" });
    }

    const cookieBuffer = Buffer.from(csrfCookie, "utf8");
    const headerBuffer = Buffer.from(csrfHeader, "utf8");

    if (
        cookieBuffer.length !== headerBuffer.length ||
        !crypto.timingSafeEqual(cookieBuffer, headerBuffer)
    ) {
        return res.status(403).json({ error: "Invalid CSRF token" });
    }

    return next();
}

function requireAdmin(req, res, next) {
    const token = getAdminTokenFromRequest(req);
    if (!token) {
        return res.status(401).json({ error: "Admin authentication required" });
    }

    const payload = verifyAdminToken(token);
    if (!payload) {
        clearAdminSession(res);
        return res.status(401).json({ error: "Invalid or expired admin session" });
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const issuedAtSeconds = Number(payload.iat);
    const idleAgeSeconds = Number.isFinite(issuedAtSeconds)
        ? nowSeconds - issuedAtSeconds
        : Number.POSITIVE_INFINITY;

    if (idleAgeSeconds > Math.floor(ADMIN_IDLE_TIMEOUT_MS / 1000)) {
        clearAdminSession(res);
        return res.status(401).json({ error: "Admin session expired due to inactivity" });
    }

    if (!String(req.headers.authorization || "").startsWith("Bearer ")) {
        refreshAdminSession(res, payload.user);
    }

    req.adminAuth = payload;
    return next();
}

function requireAdminCsrf(req, res, next) {
    const csrfCookie = readCookie(req, ADMIN_CSRF_COOKIE);
    const csrfHeader = String(req.headers["x-csrf-token"] || "").trim();

    if (!csrfCookie || !csrfHeader) {
        return res.status(403).json({ error: "CSRF token required" });
    }

    const cookieBuffer = Buffer.from(csrfCookie, "utf8");
    const headerBuffer = Buffer.from(csrfHeader, "utf8");

    if (
        cookieBuffer.length !== headerBuffer.length ||
        !crypto.timingSafeEqual(cookieBuffer, headerBuffer)
    ) {
        return res.status(403).json({ error: "Invalid CSRF token" });
    }

    return next();
}

function requireClientPage(req, res, next) {
    const token = getClientTokenFromRequest(req);
    const payload = verifyClientToken(token);

    if (!payload) {
        clearClientSession(res);
        return res.redirect(302, "/client-login.html");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const issuedAtSeconds = Number(payload.iat);
    const idleAgeSeconds = Number.isFinite(issuedAtSeconds)
        ? nowSeconds - issuedAtSeconds
        : Number.POSITIVE_INFINITY;

    if (idleAgeSeconds > Math.floor(CLIENT_IDLE_TIMEOUT_MS / 1000)) {
        clearClientSession(res);
        return res.redirect(302, "/client-login.html");
    }

    refreshClientSession(res, {
        id: payload.id,
        email: payload.email
    });

    req.clientAuth = payload;
    return next();
}

function requireAdminPage(req, res, next) {
    const token = getAdminTokenFromRequest(req);
    const payload = verifyAdminToken(token);

    if (!payload) {
        clearAdminSession(res);
        return res.redirect(302, "/admin-login.html");
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const issuedAtSeconds = Number(payload.iat);
    const idleAgeSeconds = Number.isFinite(issuedAtSeconds)
        ? nowSeconds - issuedAtSeconds
        : Number.POSITIVE_INFINITY;

    if (idleAgeSeconds > Math.floor(ADMIN_IDLE_TIMEOUT_MS / 1000)) {
        clearAdminSession(res);
        return res.redirect(302, "/admin-login.html");
    }

    refreshAdminSession(res, payload.user);

    req.adminAuth = payload;
    return next();
}

app.post("/api/admin/login", async (req, res) => {
    try {
        const user = String(req.body?.username || "").trim();
        const pass = String(req.body?.password || "");

        if (!user || !pass) {
            return res.status(400).json({ error: "Username and password are required" });
        }

        if (!validateAdminCredentials(user, pass)) {
            return res.status(401).json({ error: "Invalid admin credentials" });
        }

        attachAdminSession(res, user);
        return res.json({ success: true, user });
    } catch (error) {
        return sendInternalError(res, "Admin login error:", error);
    }
});

app.get(["/admin", "/admin.html"], requireAdminPage, (req, res) => {
    res.sendFile(path.join(__dirname, "admin.html"));
});

app.get(["/client", "/client.html"], requireClientPage, (req, res) => {
    res.sendFile(path.join(__dirname, "client.html"));
});

app.get(["/wax-pass-booking", "/wax-pass-booking.html"], requireClientPage, (req, res) => {
    res.sendFile(path.join(__dirname, "wax-pass-booking.html"));
});

app.get("/api/admin/session", requireAdmin, async (req, res) => {
    return res.json({ authenticated: true, user: req.adminAuth.user });
});

app.post("/api/admin/logout", requireAdmin, requireAdminCsrf, async (req, res) => {
    clearAdminSession(res);
    return res.json({ success: true });
});

// Get Stripe public key
app.get("/api/stripe-public-key", (req, res) => {
    if (!process.env.STRIPE_PUBLIC_KEY) {
        return res.status(500).json({ error: "Stripe public key not configured" });
    }
    res.json({ publicKey: process.env.STRIPE_PUBLIC_KEY });
});

// Get all booked appointments
app.get("/api/appointments", async (req, res) => {
    try {
        const { date } = req.query;
        const params = [];
        let query =
            "SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, TO_CHAR(time, 'HH24:MI') AS time, COALESCE(duration_minutes, 30) AS duration_minutes FROM appointments WHERE stripe_payment_id IS NOT NULL AND status IN ('confirmed', 'late')";

        if (date) {
            if (!isValidDate(date)) {
                return res.status(400).json({ error: "Invalid date" });
            }
            query += " AND date = $1";
            params.push(date);
        }

        const result = await pool.query(query, params);
        res.json(result.rows || []);
    } catch (err) {
        console.error("Database error:", err);
        return sendInternalError(res, "Appointments query error:", err);
    }
});

// Preview which specials apply for a given email + services
app.get("/api/booking/preview-specials", async (req, res) => {
    try {
        const email = String(req.query.email || "").trim();
        const referralEmail = String(req.query.referralEmail || "").trim();
        const servicesRaw = String(req.query.services || "[]");
        const hasSelectedSpecialTypes = Object.prototype.hasOwnProperty.call(
            req.query,
            "selectedSpecialTypes"
        );
        const selectedSpecialTypesRaw = hasSelectedSpecialTypes
            ? String(req.query.selectedSpecialTypes || "[]")
            : null;

        let servicesParsed = [];
        try {
            servicesParsed = JSON.parse(servicesRaw);
        } catch (e) {
            return res.status(400).json({ error: "Invalid services format" });
        }

        let selectedSpecialTypes = null;
        if (selectedSpecialTypesRaw !== null) {
            try {
                const parsedSelectedSpecialTypes = JSON.parse(selectedSpecialTypesRaw);
                selectedSpecialTypes = Array.isArray(parsedSelectedSpecialTypes)
                    ? parsedSelectedSpecialTypes
                    : null;
            } catch (e) {
                selectedSpecialTypes = null;
            }
        }

        const sanitized = sanitizeServices(servicesParsed) || [];
        const authenticatedClient = getAuthenticatedClientForRewards(req, res);
        const requestedEmail = normalizeEmail(email);
        const sessionEmail = normalizeEmail(authenticatedClient?.email || "");
        const rewardsEligible = Boolean(authenticatedClient) && requestedEmail && requestedEmail === sessionEmail;

        const specialsResult = rewardsEligible
            ? await getApplicableSpecials(
                authenticatedClient.email,
                sanitized,
                referralEmail,
                selectedSpecialTypes
            )
            : getEmptySpecialsResult();

        if (rewardsEligible) {
            const availableSpecialsResult = await getApplicableSpecials(
                authenticatedClient.email,
                sanitized,
                referralEmail
            );
            specialsResult.availableSpecials = availableSpecialsResult.specials || [];
        }

        res.json(specialsResult);
    } catch (err) {
        return sendInternalError(res, "Preview specials error:", err);
    }
});

// Free booking path: skip Stripe when a free-booking promotion applies
app.post("/api/free-booking", async (req, res) => {
    try {
        const { date, time, services, customer, consent } = req.body;

        const sanitizedServices = sanitizeServices(services);
        const customerEmail = String(customer?.email || "").trim();
        const customerName = String(customer?.name || "").trim();
        const customerPhone = String(customer?.phone || "").trim();
        const referralEmail = String(customer?.referralEmail || "").trim();
        const timezone = String(customer?.timezone || "").trim();
        const hasSelectedSpecialTypes = Object.prototype.hasOwnProperty.call(
            req.body || {},
            "selectedSpecialTypes"
        );
        const selectedSpecialTypes = hasSelectedSpecialTypes && Array.isArray(req.body?.selectedSpecialTypes)
            ? req.body.selectedSpecialTypes
            : null;
        const consentAccepted = consent?.accepted === true;
        const consentSignature = String(consent?.signature || "").trim();

        if (!consentAccepted || consentSignature.length < 2) {
            return res.status(400).json({ error: "Consent form must be signed" });
        }

        if (!signatureMatchesBookingName(consentSignature, customerName)) {
            return res.status(400).json({ error: "Consent signature must match booking name" });
        }

        if (!isValidDate(date) || !isValidTime(time) || !sanitizedServices) {
            return res.status(400).json({ error: "Missing or invalid fields" });
        }

        const authenticatedClient = getAuthenticatedClientForRewards(req, res);
        const sessionEmail = normalizeEmail(authenticatedClient?.email || "");
        const bookingEmail = normalizeEmail(customerEmail);
        const rewardsEligible = Boolean(authenticatedClient) && bookingEmail && bookingEmail === sessionEmail;

        // Re-verify loyalty eligibility server-side
        const specialsResult = rewardsEligible
            ? await getApplicableSpecials(
                authenticatedClient.email,
                sanitizedServices,
                referralEmail,
                selectedSpecialTypes
            )
            : getEmptySpecialsResult();
        if (!specialsResult.isFree) {
            return res.status(400).json({ error: "Free booking not applicable for this account" });
        }
        const appliedReferralEmail = specialsResult.specials.some((s) => s.type === "referral")
            ? referralEmail
            : "";

        const requestedDuration = getServicesTotalDuration(sanitizedServices);

        const appointmentId = await withAppointmentLocks(
            [getAppointmentDateLockKey(date)],
            async (db) => {
                const conflict = await db.query(
                    `SELECT id FROM appointments
                     WHERE date = $1 AND status IN ('confirmed','late')
                     AND time < ($2::time + make_interval(mins => $3::int))
                     AND $2::time < (time + make_interval(mins => COALESCE(duration_minutes, 30)::int))
                     LIMIT 1`,
                    [date, time, requestedDuration]
                );

                if (conflict.rows.length > 0) {
                    const lockError = new Error("Time slot already booked");
                    lockError.statusCode = 409;
                    throw lockError;
                }

                let clientId = null;
                if (customerEmail) {
                    const cl = await db.query(
                        "SELECT id FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1",
                        [customerEmail]
                    );
                    clientId = cl.rows[0]?.id || null;
                }

                const freeToken = `WAXPASS-FREE-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
                const specialTypes = JSON.stringify(specialsResult.specials.map((s) => s.type));

                const insertResult = await db.query(
                    `INSERT INTO appointments
                     (date, time, duration_minutes, services, email, name, phone, price,
                      stripe_payment_id, timezone, client_id, consent_signature,
                      consent_accepted_at, referred_by_email, applied_specials, discount_cents, status)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW(),$13,$14,$15,'confirmed')
                     RETURNING id`,
                    [
                        date, time, requestedDuration,
                        JSON.stringify(sanitizedServices),
                        customerEmail, customerName, customerPhone,
                        0, freeToken, timezone || null, clientId,
                        consentSignature, appliedReferralEmail || null,
                        specialTypes, 0
                    ]
                );

                return insertResult.rows[0].id;
            }
        );

        res.json({
            success: true,
            appointmentId,
            appointment: {
                date, time,
                services: sanitizedServices,
                email: customerEmail,
                name: customerName,
                phone: customerPhone,
                price: 0,
                timezone: timezone || null
            }
        });

        sendInternalBookingNotification({
            source: "free-booking",
            appointmentId,
            date,
            time,
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            services: sanitizedServices,
            totalPaidCents: 0,
            consentSignature
        }).catch((e) => console.error("Internal booking notify error:", e));

        // Send confirmation email
        if (customerEmail && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            transporter.sendMail({
                from: process.env.EMAIL_USER,
                to: customerEmail,
                subject: "Booking Confirmation - Lunelia Esthetics",
                    html: `
                    <h2>Your Booking is Confirmed!</h2>
                    <p>Hi ${escapeHtml(customerName) || "Valued Client"},</p>
                    <p>Your promotional reward has been applied — this appointment is on the house.</p>
                    <p><strong>Date:</strong> ${escapeHtml(date)}</p>
                    <p><strong>Time:</strong> ${escapeHtml(time)}</p>
                    <p><strong>Services:</strong> ${sanitizedServices.map((s) => escapeHtml(s.name)).join(", ")}</p>
                    <p>We look forward to seeing you!</p>
                    <p>Lunelia Esthetics</p>
                `
            }).catch((e) => console.error("Free booking email error:", e));
        }
    } catch (err) {
        if (err?.statusCode === 409 || err?.code === "23505") {
            return res.status(409).json({ error: "Time slot already booked" });
        }

        return sendInternalError(res, "Free booking error:", err);
    }
});

// Create payment intent (Stripe Checkout)
app.post("/api/create-payment-intent", async (req, res) => {
    try {
        const { amount, date, time, services, customer, consent } = req.body;
        
        const sanitizedServices = sanitizeServices(services);
        const parsedAmount = Number(amount);
        const customerName = customer?.name?.trim() || "";
        const customerEmail = customer?.email?.trim() || "";
        const customerPhone = customer?.phone?.trim() || "";
        const referralEmail = customer?.referralEmail?.trim() || "";
        const timezone = customer?.timezone?.trim() || "";
        const hasSelectedSpecialTypes = Object.prototype.hasOwnProperty.call(
            req.body || {},
            "selectedSpecialTypes"
        );
        const selectedSpecialTypes = hasSelectedSpecialTypes && Array.isArray(req.body?.selectedSpecialTypes)
            ? req.body.selectedSpecialTypes
            : null;
        const consentAccepted = consent?.accepted === true;
        const consentSignature = String(consent?.signature || "").trim();

        if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
        }

        if (!consentAccepted || consentSignature.length < 2) {
            return res.status(400).json({ error: "Consent form must be signed" });
        }

        if (!signatureMatchesBookingName(consentSignature, customerName)) {
            return res.status(400).json({ error: "Consent signature must match booking name" });
        }

        if (referralEmail && !/^\S+@\S+\.\S+$/.test(referralEmail)) {
            return res.status(400).json({ error: "Referral email is invalid" });
        }

        if (!isValidDate(date) || !isValidTime(time) || !sanitizedServices) {
            return res.status(400).json({ error: "Missing or invalid fields" });
        }

        const authenticatedClient = getAuthenticatedClientForRewards(req, res);
        const sessionEmail = normalizeEmail(authenticatedClient?.email || "");
        const bookingEmail = normalizeEmail(customerEmail);
        const rewardsEligible = Boolean(authenticatedClient) && bookingEmail && bookingEmail === sessionEmail;

        const requestedDuration = getServicesTotalDuration(sanitizedServices);

        if (!Number.isInteger(requestedDuration) || requestedDuration <= 0) {
            return res.status(400).json({ error: "Invalid service duration" });
        }

        // Re-verify applicable specials server-side so the client cannot fake discounts
        const specialsResult = rewardsEligible
            ? await getApplicableSpecials(
                authenticatedClient.email,
                sanitizedServices,
                referralEmail,
                selectedSpecialTypes
            )
            : getEmptySpecialsResult();
        const appliedReferralEmail = specialsResult.specials.some((s) => s.type === "referral")
            ? referralEmail
            : "";

        // Compute authoritative expected amount: base prices + overrides - flat discount
        let expectedAmountCents = sanitizedServices.reduce((sum, svc) => sum + svc.price * 100, 0);
        for (const svc of sanitizedServices) {
            const override = specialsResult.priceOverridesCents[svc.id];
            if (override !== undefined) {
                expectedAmountCents += override - svc.price * 100;
            }
        }
        expectedAmountCents = Math.max(0, expectedAmountCents - specialsResult.flatDiscountCents);

        if (specialsResult.isFree) {
            // The loyalty special makes this entirely free — must use /api/free-booking
            return res.status(400).json({ error: "BOOKING_IS_FREE", free: true });
        }

        if (parsedAmount !== expectedAmountCents) {
            return res.status(400).json({ error: "Amount does not match services" });
        }

        const conflict = await pool.query(
            `
                SELECT id
                FROM appointments
                                WHERE date = $1
                                    AND status IN ('confirmed', 'late')
                  AND time < ($2::time + make_interval(mins => $3::int))
                  AND $2::time < (time + make_interval(mins => COALESCE(duration_minutes, 30)::int))
                LIMIT 1
            `,
            [date, time, requestedDuration]
        );
        if (conflict.rows.length > 0) {
            return res.status(409).json({ error: "Time slot already booked" });
        }

        const serviceSummary = sanitizedServices.map((service) => service.name).join(", ");
        const appliedSpecialLabels = specialsResult.specials
            .map((special) => String(special?.label || "").trim())
            .filter(Boolean);
        const checkoutDescription = [
            serviceSummary,
            appliedSpecialLabels.length > 0
                ? `Specials applied: ${appliedSpecialLabels.join("; ")}`
                : ""
        ]
            .filter(Boolean)
            .join(" | ")
            .slice(0, 500);
        
        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name:
                                appliedSpecialLabels.length > 0
                                    ? "Lunelia Esthetics Booking (Special Applied)"
                                    : "Lunelia Esthetics Booking",
                            description: checkoutDescription
                        },
                        unit_amount: parsedAmount
                    },
                    quantity: 1
                }
            ],
            mode: "payment",
            customer_email: customerEmail || undefined,
            success_url: `${PUBLIC_APP_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${PUBLIC_APP_URL}/booking.html`,
            metadata: {
                date,
                time,
                durationMinutes: String(requestedDuration),
                services: JSON.stringify(sanitizedServices),
                name: customerName,
                email: customerEmail,
                phone: customerPhone,
                referralEmail: appliedReferralEmail,
                timezone,
                consentAccepted: String(consentAccepted),
                consentSignature,
                appliedSpecials: JSON.stringify(specialsResult.specials.map((s) => s.type)),
                discountCents: String(specialsResult.flatDiscountCents + Object.entries(specialsResult.priceOverridesCents).reduce((sum, [id, overrideCents]) => {
                    const svc = sanitizedServices.find((s) => s.id === id);
                    return svc ? sum + (overrideCents - svc.price * 100) : sum;
                }, 0))
            }
        });
        
        // Save session info to database
        try {
            await pool.query(
                "INSERT INTO payments (stripe_session_id, amount, status) VALUES ($1, $2, $3)",
                [session.id, parsedAmount, "pending"]
            );
        } catch (dbErr) {
            console.error("DB Error:", dbErr);
        }
        
        res.json({ sessionId: session.id });
    } catch (error) {
        console.error("Stripe Error:", error);
        return sendInternalError(res, "Create payment intent error:", error);
    }
});

// Verify payment and create appointment
app.post("/api/confirm-booking", async (req, res) => {
    try {
        const { sessionId, email, name, phone } = req.body;

        if (!sessionId) {
            return res.status(400).json({ error: "Missing session ID" });
        }

        // Get session details from Stripe
        const session = await stripe.checkout.sessions.retrieve(sessionId);

        if (session.payment_status !== "paid") {
            return res.status(400).json({ error: "Payment not completed" });
        }

        const {
            date,
            time,
            services,
            durationMinutes,
            name: metaName,
            email: metaEmail,
            phone: metaPhone,
            referralEmail,
            timezone,
            consentAccepted,
            consentSignature,
            appliedSpecials: metaAppliedSpecials,
            discountCents: metaDiscountCents
        } =
            session.metadata || {};

        if (!isValidDate(date) || !isValidTime(time) || !services) {
            return res.status(400).json({ error: "Missing booking metadata" });
        }

        const appointmentEmail = (email || metaEmail || session.customer_details?.email || "").trim();
        const appointmentName = (name || metaName || "").trim();
        const appointmentPhone = (phone || metaPhone || "").trim();
        const referredByEmail = String(referralEmail || "").trim();
        const signedConsent = String(consentAccepted || "") === "true";
        const signedConsentName = String(consentSignature || "").trim();
        const servicesList = (() => {
            try {
                const parsed = JSON.parse(services);
                return Array.isArray(parsed) ? parsed : [];
            } catch (err) {
                return [];
            }
        })();
        const calculatedDuration = getServicesTotalDuration(sanitizeServices(servicesList) || []);
        const parsedDuration = Number(durationMinutes);
        const appointmentDuration =
            Number.isInteger(parsedDuration) && parsedDuration > 0
                ? parsedDuration
                : calculatedDuration;

        if (!Number.isInteger(appointmentDuration) || appointmentDuration <= 0) {
            return res.status(400).json({ error: "Invalid booking duration" });
        }

        if (!signedConsent || signedConsentName.length < 2) {
            return res.status(400).json({ error: "Missing signed consent form" });
        }

        if (!signatureMatchesBookingName(signedConsentName, appointmentName)) {
            return res.status(400).json({ error: "Consent signature must match booking name" });
        }

        const responsePayload = await withAppointmentLocks(
            [getAppointmentDateLockKey(date)],
            async (db) => {
                let clientId = null;
                if (appointmentEmail) {
                    const clientLookup = await db.query(
                        "SELECT id FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1",
                        [appointmentEmail]
                    );
                    clientId = clientLookup.rows[0]?.id || null;
                }

                const existing = await db.query(
                    "SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, TO_CHAR(time, 'HH24:MI') AS time, COALESCE(duration_minutes, 30) AS duration_minutes, services, email, name, phone, price, timezone FROM appointments WHERE stripe_payment_id = $1 LIMIT 1",
                    [session.payment_intent]
                );
                if (existing.rows.length > 0) {
                    const existingRow = existing.rows[0];
                    let parsedServices = [];
                    try {
                        parsedServices = JSON.parse(existingRow.services || "[]");
                    } catch (err) {
                        parsedServices = [];
                    }

                    return {
                        success: true,
                        appointmentId: existingRow.id,
                        appointment: {
                            date: existingRow.date,
                            time: existingRow.time,
                            services: parsedServices,
                            email: existingRow.email,
                            name: existingRow.name,
                            phone: existingRow.phone,
                            price: existingRow.price,
                            timezone: existingRow.timezone
                        }
                    };
                }

                const overlap = await db.query(
                    `
                        SELECT id
                        FROM appointments
                        WHERE date = $1
                          AND status IN ('confirmed', 'late')
                          AND time < ($2::time + make_interval(mins => $3::int))
                          AND $2::time < (time + make_interval(mins => COALESCE(duration_minutes, 30)::int))
                        LIMIT 1
                    `,
                    [date, time, appointmentDuration]
                );

                if (overlap.rows.length > 0) {
                    const lockError = new Error("Time slot already booked");
                    lockError.statusCode = 409;
                    throw lockError;
                }

                const result = await db.query(
                    "INSERT INTO appointments (date, time, duration_minutes, services, email, name, phone, price, stripe_payment_id, timezone, client_id, consent_signature, consent_accepted_at, referred_by_email, applied_specials, discount_cents) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13, $14, $15) RETURNING id",
                    [
                        date,
                        time,
                        appointmentDuration,
                        services,
                        appointmentEmail,
                        appointmentName,
                        appointmentPhone,
                        session.amount_total,
                        session.payment_intent,
                        timezone || null,
                        clientId,
                        signedConsentName,
                        referredByEmail || null,
                        metaAppliedSpecials || null,
                        metaDiscountCents ? parseInt(metaDiscountCents, 10) : 0
                    ]
                );

                await db.query(
                    "UPDATE payments SET status = $1, stripe_payment_intent_id = $2 WHERE stripe_session_id = $3",
                    ["completed", session.payment_intent, sessionId]
                );

                return {
                    success: true,
                    appointmentId: result.rows[0].id,
                    appointment: {
                        date,
                        time,
                        services: servicesList,
                        email: appointmentEmail,
                        name: appointmentName,
                        phone: appointmentPhone,
                        price: session.amount_total,
                        timezone: timezone || null
                    }
                };
            }
        );

        res.json(responsePayload);

        sendInternalBookingNotification({
            source: "paid-booking",
            appointmentId: responsePayload?.appointmentId,
            date,
            time,
            name: appointmentName,
            email: appointmentEmail,
            phone: appointmentPhone,
            services: servicesList,
            totalPaidCents: Number(session.amount_total) || 0,
            consentSignature: signedConsentName
        }).catch((e) => {
            console.error("Internal booking notify error:", e);
        });

        if (responsePayload.appointmentId && appointmentEmail && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            transporter
                .sendMail({
                    from: process.env.EMAIL_USER,
                    to: appointmentEmail,
                    subject: "Booking Confirmation - Lunelia Esthetics",
                    html: `
                        <h2>Your Booking is Confirmed!</h2>
                        <p>Hi ${escapeHtml(appointmentName) || "Valued Client"},</p>
                        <p>Thank you for booking with Lunelia Esthetics. Here are your appointment details:</p>
                        <p><strong>Date:</strong> ${escapeHtml(date)}</p>
                        <p><strong>Time:</strong> ${escapeHtml(time)}</p>
                        <p><strong>Services:</strong> ${servicesList.map((service) => escapeHtml(service.name)).join(", ")}</p>
                        <p><strong>Amount Paid:</strong> $${(session.amount_total / 100).toFixed(2)}</p>

                        <h3>Booking Policy</h3>
                        <ul>
                            <li>If you are more than 10 minutes late, your appointment may be forfeited and rescheduled.</li>
                            <li>No-shows are charged 50% of the booked service total.</li>
                            <li>Last-minute cancellations (within 24 hours) are charged 30% of the booked service total.</li>
                        </ul>

                        <p>We look forward to seeing you!</p>
                        <p>Lunelia Esthetics</p>
                    `
                })
                .catch((emailError) => {
                    console.error("Email Error:", emailError);
                });
        }
    } catch (error) {
        console.error("Error:", error);
        if (error?.statusCode === 409 || error?.code === "23505") {
            return res.status(409).json({ error: "Time slot already booked" });
        }
        return sendInternalError(res, "Confirm booking error:", error);
    }
});

// Webhook for Stripe events
app.post(WEBHOOK_PATH, express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;
    
    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }
    
    // Handle checkout.session.completed
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        try {
            await pool.query(
                "UPDATE payments SET status = $1, stripe_payment_intent_id = $2 WHERE stripe_session_id = $3",
                ["completed", session.payment_intent, session.id]
            );

            if (session?.metadata?.type === "wax_pass_purchase") {
                const waxPass = await finalizeWaxPassPurchaseFromSession(session);

                // Send purchase confirmation email
                if (waxPass && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                    try {
                        const clientId = Number(session.metadata?.clientId || 0);
                        const clientRow = clientId
                            ? (await pool.query("SELECT name, email FROM clients WHERE id = $1 LIMIT 1", [clientId])).rows[0]
                            : null;

                        const clientName = clientRow?.name || "Valued Client";
                        const clientEmail = clientRow?.email || session.customer_details?.email || null;

                        if (clientEmail) {
                            const tierLabels = { 1: "Tier 1 (5 credits)", 2: "Tier 2 (8 credits)", 3: "Tier 3 (12 credits — full body)" };
                            const tierLabel = tierLabels[Number(waxPass.tier)] || `Tier ${waxPass.tier}`;
                            const serviceName = String(waxPass.service_name || session.metadata?.serviceName || "").trim() || "Wax Service";
                            const amountPaid = (Number(waxPass.price_paid_cents || session.amount_total || 0) / 100).toFixed(2);
                            const totalCredits = Number(waxPass.total_credits);

                            await transporter.sendMail({
                                from: process.env.EMAIL_USER,
                                to: clientEmail,
                                subject: "Wax Pass Purchase Confirmed - Lunelia Esthetics",
                                html: `
                                    <h2>Your Wax Pass is Ready!</h2>
                                    <p>Hi ${escapeHtml(clientName)},</p>
                                    <p>Thank you for purchasing a Wax Pass with Lunelia Esthetics. Your pass is now active and ready to use.</p>

                                    <h3>Pass Details</h3>
                                    <p><strong>Service:</strong> ${escapeHtml(serviceName)}</p>
                                    <p><strong>Pass Tier:</strong> ${escapeHtml(tierLabel)}</p>
                                    <p><strong>Credits Included:</strong> ${escapeHtml(String(totalCredits))}</p>
                                    <p><strong>Amount Paid:</strong> $${amountPaid}</p>

                                    <p>You can book your appointments using your Wax Pass credits by signing into your client portal.</p>

                                    <h3>Wax Pass Policy</h3>
                                    <ul>
                                        <li>Wax Pass credits are non-refundable.</li>
                                        <li>If you are late or no-show for an appointment booked with a wax pass, that wax pass credit is considered spent and is non-refundable.</li>
                                        <li>Cancellations made with more than 24 hours' notice will have their credit returned to your pass.</li>
                                    </ul>

                                    <p>We look forward to seeing you!</p>
                                    <p>Lunelia Esthetics</p>
                                `
                            });
                        }
                    } catch (emailError) {
                        console.error("Wax pass confirmation email error:", emailError);
                    }
                }
            }
        } catch (err) {
            console.error("Webhook update error:", err);
        }
    }
    
    res.json({ received: true });
});

app.post("/api/client/register", async (req, res) => {
    try {
        const name = String(req.body?.name || "").trim();
        const email = normalizeEmail(req.body?.email || "");
        const password = String(req.body?.password || "");

        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({ error: "Valid email is required" });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        const result = await pool.query(
            `
                INSERT INTO clients (
                    name,
                    email,
                    password_hash,
                    email_verified
                )
                VALUES ($1, $2, $3, FALSE)
                RETURNING id, name, email
            `,
            [name || null, email, hashPassword(password)]
        );

        const client = result.rows[0];
        let emailDispatchFailed = false;

        if (client?.email) {
            try {
                const rawVerificationToken = await issueEmailVerificationToken(client.id);
                const verifyLink = buildVerificationLink(req, client.email, rawVerificationToken);
                await sendVerificationEmail(client, verifyLink);
            } catch (emailError) {
                console.error("Account email error:", emailError);
                emailDispatchFailed = true;
            }
        }

        if (IS_PRODUCTION && emailDispatchFailed) {
            return res.status(503).json({
                error: "Account created, but we could not send a verification email. Please try signing in again to resend it.",
                requiresVerification: true
            });
        }

        const payload = {
            success: true,
            message: "Account created. Please verify your email before signing in."
        };

        return res.json(payload);
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "Account already exists for this email" });
        }
        return sendInternalError(res, "Client register error:", error);
    }
});

app.post("/api/client/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || "");
        const password = String(req.body?.password || "");

        const result = await pool.query(
            `
                SELECT id, name, email, password_hash, COALESCE(email_verified, FALSE) AS email_verified
                FROM clients
                WHERE LOWER(email) = LOWER($1)
                LIMIT 1
            `,
            [email]
        );

        const client = result.rows[0];
        if (!client || !verifyPassword(password, client.password_hash)) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        if (!client.email_verified) {
            return res.status(403).json({
                error: "Please verify your email before signing in.",
                requiresVerification: true
            });
        }

        const clientSession = {
            id: client.id,
            email: client.email,
            name: client.name
        };

        attachClientSession(res, clientSession);

        return res.json({
            success: true,
            client: clientSession
        });
    } catch (error) {
        return sendInternalError(res, "Client login error:", error);
    }
});

app.post("/api/client/verify-email", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || "");
        const token = String(req.body?.token || "").trim();

        if (!token) {
            return res.status(400).json({ error: "Verification token is required" });
        }

        const tokenHash = hashResetToken(token);
        const result = await pool.query(
            `
                SELECT id, name, email
                FROM clients
                WHERE email_verification_token_hash = $1
                  AND email_verification_expires_at IS NOT NULL
                  AND email_verification_expires_at > NOW()
                LIMIT 1
            `,
            [tokenHash]
        );

        const client = result.rows[0] || null;
        if (!client) {
            return res.status(400).json({ error: "Invalid or expired verification link" });
        }

        if (email && normalizeEmail(client.email) !== email) {
            return res.status(400).json({ error: "Invalid or expired verification link" });
        }

        await pool.query(
            `
                UPDATE clients
                SET email_verified = TRUE,
                    email_verification_token_hash = NULL,
                    email_verification_expires_at = NULL
                WHERE id = $1
            `,
            [client.id]
        );

        return res.json({
            success: true,
            message: "Email verified. You can now sign in.",
            client: {
                id: client.id,
                name: client.name,
                email: client.email
            }
        });
    } catch (error) {
        return sendInternalError(res, "Client verify-email error:", error);
    }
});

app.post("/api/client/resend-verification", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || "");

        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({ error: "Valid email is required" });
        }

        const result = await pool.query(
            `
                SELECT id, name, email, COALESCE(email_verified, FALSE) AS email_verified
                FROM clients
                WHERE LOWER(email) = LOWER($1)
                LIMIT 1
            `,
            [email]
        );

        const client = result.rows[0] || null;

        if (!client) {
            return res.json({
                success: true,
                message: "If an account exists for this email, a verification email has been sent."
            });
        }

        if (client.email_verified) {
            return res.json({
                success: true,
                alreadyVerified: true,
                message: "This account is already verified. You can sign in now."
            });
        }

        const rawVerificationToken = await issueEmailVerificationToken(client.id);
        const verifyLink = buildVerificationLink(req, client.email, rawVerificationToken);
        await sendVerificationEmail(client, verifyLink);

        return res.json({
            success: true,
            message: "Verification email sent. Please check your inbox."
        });
    } catch (error) {
        console.error("Verification resend error:", error);
        return res.status(503).json({
            error: "Unable to send verification email right now. Please try again later."
        });
    }
});

app.post("/api/client/forgot-password", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || "");
        let debugResetLink = "";
        let emailDispatchFailed = false;

        if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({ error: "Valid email is required" });
        }

        const result = await pool.query(
            "SELECT id, name, email FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1",
            [email]
        );

        const client = result.rows[0] || null;

        if (client) {
            const rawToken = crypto.randomBytes(32).toString("hex");
            const tokenHash = hashResetToken(rawToken);
            const expiry = new Date(Date.now() + 60 * 60 * 1000);
            const resetLink = `${PUBLIC_APP_URL}/reset-password.html?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(email)}`;

            if (!IS_PRODUCTION) {
                debugResetLink = resetLink;
            }

            await pool.query(
                "UPDATE clients SET reset_password_token_hash = $1, reset_password_expires_at = $2 WHERE id = $3",
                [tokenHash, expiry, client.id]
            );

            if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                try {
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: email,
                        subject: "Reset Your Lunelia Esthetics Password",
                        html: `
                            <h2>Password Reset Request</h2>
                            <p>Hi ${escapeHtml(client.name) || "there"},</p>
                            <p>Use the link below to reset your password. This link expires in 1 hour.</p>
                            <p><a href="${escapeHtml(resetLink)}">Reset Password</a></p>
                        `
                    });
                } catch (emailError) {
                    console.error("Password reset email error:", emailError);
                    emailDispatchFailed = true;
                }
            } else {
                emailDispatchFailed = true;
            }

            if (IS_PRODUCTION && emailDispatchFailed) {
                return res.status(503).json({
                    error: "Unable to send reset email right now. Please try again later."
                });
            }
        }

        const payload = {
            success: true,
            message: "If an account exists for this email, a reset link has been sent."
        };

        if (!IS_PRODUCTION && debugResetLink) {
            payload.debugResetLink = debugResetLink;
            if (emailDispatchFailed) {
                payload.message =
                    "Email delivery is unavailable locally. Use the generated reset link below.";
            }
        }

        return res.json(payload);
    } catch (error) {
        return sendInternalError(res, "Client forgot-password error:", error);
    }
});

app.post("/api/client/reset-password", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || "");
        const token = String(req.body?.token || "").trim();
        const password = String(req.body?.password || "");

        if (!token) {
            return res.status(400).json({ error: "Reset token is required" });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        const tokenHash = hashResetToken(token);
        const result = await pool.query(
            `
                SELECT id, email
                FROM clients
                WHERE reset_password_token_hash = $1
                  AND reset_password_expires_at IS NOT NULL
                  AND reset_password_expires_at > NOW()
                LIMIT 1
            `,
            [tokenHash]
        );

        const client = result.rows[0];
        if (!client) {
            return res.status(400).json({ error: "Invalid or expired reset link" });
        }

        if (email && normalizeEmail(client.email) !== email) {
            return res.status(400).json({ error: "Invalid or expired reset link" });
        }

        await pool.query(
            `
                UPDATE clients
                SET password_hash = $1,
                    reset_password_token_hash = NULL,
                    reset_password_expires_at = NULL
                WHERE id = $2
            `,
            [hashPassword(password), client.id]
        );

        return res.json({ success: true, message: "Password updated successfully" });
    } catch (error) {
        return sendInternalError(res, "Client reset-password error:", error);
    }
});

app.get("/api/client/session", requireClient, async (req, res) => {
    return res.json({
        success: true,
        client: {
            id: req.clientAuth.id,
            email: req.clientAuth.email
        }
    });
});

app.post("/api/client/logout", requireClient, requireCsrf, async (req, res) => {
    clearClientSession(res);
    return res.json({ success: true });
});

async function syncClientPastAppointments(email) {
    await pool.query(
        `
            UPDATE appointments
            SET status = 'completed'
            WHERE LOWER(email) = LOWER($1)
              AND status IN ('confirmed', 'late')
              AND (date + time) < NOW()
        `,
        [email]
    );
}

app.get("/api/client/appointments", requireClient, async (req, res) => {
    try {
        const email = normalizeEmail(req.clientAuth?.email || "");

        await syncClientPastAppointments(email);

        const result = await pool.query(
            `
                SELECT
                    id,
                    TO_CHAR(date, 'YYYY-MM-DD') AS date,
                    TO_CHAR(time, 'HH24:MI') AS time,
                    COALESCE(duration_minutes, 30) AS duration_minutes,
                    services,
                    status,
                    price,
                    cancellation_fee_percent,
                    no_show_fee_percent,
                    created_at
                FROM appointments
                WHERE LOWER(email) = LOWER($1)
                  AND status IN ('confirmed', 'late')
                  AND (date + time) >= NOW()
                ORDER BY date ASC, time ASC
            `,
            [email]
        );

        return res.json(result.rows || []);
    } catch (error) {
        return sendInternalError(res, "Client appointments error:", error);
    }
});

app.get("/api/client/appointments/past", requireClient, async (req, res) => {
    try {
        const email = normalizeEmail(req.clientAuth?.email || "");

        await syncClientPastAppointments(email);

        const result = await pool.query(
            `
                SELECT
                    id,
                    TO_CHAR(date, 'YYYY-MM-DD') AS date,
                    TO_CHAR(time, 'HH24:MI') AS time,
                    COALESCE(duration_minutes, 30) AS duration_minutes,
                    services,
                    status,
                    price,
                    cancellation_fee_percent,
                    no_show_fee_percent,
                    created_at
                FROM appointments
                WHERE LOWER(email) = LOWER($1)
                  AND (
                    status IN ('cancelled', 'completed', 'no_show')
                    OR (date + time) < NOW()
                  )
                ORDER BY date DESC, time DESC
            `,
            [email]
        );

        return res.json(result.rows || []);
    } catch (error) {
        return sendInternalError(res, "Client past appointments error:", error);
    }
});

app.post("/api/client/appointments/:id/reschedule", requireClient, requireCsrf, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        const email = normalizeEmail(req.clientAuth?.email || "");
        const { date, time } = req.body || {};

        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ error: "Invalid appointment ID" });
        }

        if (!isValidDate(date) || !isValidTime(time)) {
            return res.status(400).json({ error: "Valid date and time are required" });
        }

        await withAppointmentLocks([getAppointmentDateLockKey(date)], async (db) => {
            const existing = await db.query(
                `
                    SELECT id, COALESCE(duration_minutes, 30) AS duration_minutes
                    FROM appointments
                    WHERE id = $1
                      AND LOWER(email) = LOWER($2)
                      AND status IN ('confirmed', 'late')
                    LIMIT 1
                    FOR UPDATE
                `,
                [appointmentId, email]
            );

            if (existing.rows.length === 0) {
                const notFoundError = new Error("Appointment not found");
                notFoundError.statusCode = 404;
                throw notFoundError;
            }

            const duration = Number(existing.rows[0].duration_minutes) || 30;

            const overlap = await db.query(
                `
                    SELECT id
                    FROM appointments
                    WHERE id <> $1
                      AND date = $2
                      AND status IN ('confirmed', 'late')
                      AND time < ($3::time + make_interval(mins => $4::int))
                      AND $3::time < (time + make_interval(mins => COALESCE(duration_minutes, 30)::int))
                    LIMIT 1
                `,
                [appointmentId, date, time, duration]
            );

            if (overlap.rows.length > 0) {
                const lockError = new Error("Time slot already booked");
                lockError.statusCode = 409;
                throw lockError;
            }

            await db.query(
                "UPDATE appointments SET date = $1, time = $2 WHERE id = $3",
                [date, time, appointmentId]
            );
        });

        return res.json({ success: true, date, time });
    } catch (error) {
        if (error?.statusCode === 404) {
            return res.status(404).json({ error: "Appointment not found" });
        }
        if (error?.statusCode === 409 || error?.code === "23505") {
            return res.status(409).json({ error: "Time slot already booked" });
        }
        return sendInternalError(res, "Client reschedule error:", error);
    }
});

app.post("/api/client/appointments/:id/cancel", requireClient, requireCsrf, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        const email = normalizeEmail(req.clientAuth?.email || "");

        const result = await pool.query(
                        `
                                SELECT id, date::text AS date, TO_CHAR(time, 'HH24:MI') AS time, status, price,
                                             stripe_payment_id, wax_pass_id
                                FROM appointments
                                WHERE id = $1
                                    AND LOWER(email) = LOWER($2)
                                LIMIT 1
                        `,
            [appointmentId, email]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        const appointment = result.rows[0];
        if (!["confirmed", "late"].includes(String(appointment.status || "").toLowerCase())) {
            return res.status(400).json({ error: "Only active appointments can be cancelled" });
        }

        const feePercent = calculateLateCancellationFeePercent(appointment.date, appointment.time);
        const settlement = await settleAppointmentPolicyWithStripe(
            appointment,
            feePercent,
            "client_cancel"
        );

        const waxPassId = Number(appointment.wax_pass_id) || 0;
        let waxPassCreditForfeited = false;
        let waxPassCreditRestored = false;

        if (waxPassId && feePercent > 0) {
            await pool.query(
                `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(),
                        cancellation_fee_percent = $1, no_show_fee_percent = 0,
                        wax_pass_credit_forfeited = TRUE WHERE id = $2`,
                [feePercent, appointmentId]
            );
            waxPassCreditForfeited = true;
        } else if (waxPassId && feePercent === 0) {
            await pool.query(
                `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(),
                        cancellation_fee_percent = $1, no_show_fee_percent = 0,
                        wax_pass_credit_forfeited = FALSE WHERE id = $2`,
                [feePercent, appointmentId]
            );
            await pool.query(
                `UPDATE wax_passes SET used_credits = GREATEST(0, used_credits - 1),
                     status = CASE WHEN status = 'completed' THEN 'active' ELSE status END
                 WHERE id = $1`,
                [waxPassId]
            );
            waxPassCreditRestored = true;
        } else {
            await pool.query(
                "UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), cancellation_fee_percent = $1, no_show_fee_percent = 0 WHERE id = $2",
                [feePercent, appointmentId]
            );
        }

        return res.json({ success: true, feePercent, settlement, isWaxPass: waxPassId > 0, waxPassCreditForfeited, waxPassCreditRestored });
    } catch (error) {
        return sendInternalError(res, "Client cancel error:", error);
    }
});

app.post("/api/admin/appointments/:id/no-show", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ error: "Invalid appointment ID" });
        }

        const existing = await pool.query(
            `
                SELECT id, status, price, stripe_payment_id, wax_pass_id
                FROM appointments
                WHERE id = $1
                LIMIT 1
            `,
            [appointmentId]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        const appointment = existing.rows[0];
        if (!["confirmed", "late"].includes(String(appointment.status || "").toLowerCase())) {
            return res.status(400).json({ error: "Only active appointments can be marked as no-show" });
        }

        const settlement = await settleAppointmentPolicyWithStripe(
            appointment,
            50,
            "admin_no_show"
        );

        const waxPassId = Number(appointment.wax_pass_id) || 0;

        const result = await pool.query(
            `
                UPDATE appointments
                SET status = 'no_show',
                    no_show_fee_percent = 50,
                    cancellation_fee_percent = 0,
                    cancelled_at = NULL,
                    wax_pass_credit_forfeited = CASE WHEN wax_pass_id IS NOT NULL THEN TRUE ELSE FALSE END
                WHERE id = $1
                  AND status IN ('confirmed', 'late')
                RETURNING id
            `,
            [appointmentId]
        );

        return res.json({
            success: true,
            id: result.rows[0].id,
            feePercent: 50,
            settlement,
            isWaxPass: waxPassId > 0,
            waxPassCreditForfeited: waxPassId > 0
        });
    } catch (error) {
        return sendInternalError(res, "Admin no-show error:", error);
    }
});

app.post("/api/admin/appointments/:id/late", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ error: "Invalid appointment ID" });
        }

        const result = await pool.query(
            `
                UPDATE appointments
                SET status = 'late',
                    no_show_fee_percent = 0,
                    cancellation_fee_percent = 0,
                    cancelled_at = NULL
                WHERE id = $1
                  AND status = 'confirmed'
                RETURNING id
            `,
            [appointmentId]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Only confirmed appointments can be marked as late" });
        }

        return res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        return sendInternalError(res, "Admin late error:", error);
    }
});

app.post("/api/admin/appointments/:id/reverse-no-show", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ error: "Invalid appointment ID" });
        }

        const existing = await pool.query(
            "SELECT id, status, wax_pass_id FROM appointments WHERE id = $1 LIMIT 1",
            [appointmentId]
        );
        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        const result = await pool.query(
            `
                UPDATE appointments
                SET status = 'confirmed',
                    no_show_fee_percent = 0,
                    wax_pass_credit_forfeited = FALSE
                WHERE id = $1
                  AND status = 'no_show'
                RETURNING id
            `,
            [appointmentId]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Only no-show appointments can be reversed" });
        }

        // Restore wax pass credit when reversing a no-show
        const waxPassId = Number(existing.rows[0].wax_pass_id) || 0;
        if (waxPassId) {
            await pool.query(
                `UPDATE wax_passes
                 SET used_credits = GREATEST(0, used_credits - 1),
                     status = CASE WHEN status = 'completed' THEN 'active' ELSE status END
                 WHERE id = $1`,
                [waxPassId]
            );
        }

        return res.json({ success: true, id: result.rows[0].id, waxPassCreditRestored: waxPassId > 0 });
    } catch (error) {
        return sendInternalError(res, "Admin reverse no-show error:", error);
    }
});

app.post("/api/admin/appointments/:id/reschedule", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        const { date, time } = req.body || {};

        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ error: "Invalid appointment ID" });
        }

        if (!isValidDate(date) || !isValidTime(time)) {
            return res.status(400).json({ error: "Valid date and time are required" });
        }

        await withAppointmentLocks([getAppointmentDateLockKey(date)], async (db) => {
            const existing = await db.query(
                `
                    SELECT id, COALESCE(duration_minutes, 30) AS duration_minutes
                    FROM appointments
                    WHERE id = $1
                      AND status IN ('confirmed', 'late')
                    LIMIT 1
                    FOR UPDATE
                `,
                [appointmentId]
            );

            if (existing.rows.length === 0) {
                const notFoundError = new Error("Appointment not found");
                notFoundError.statusCode = 404;
                throw notFoundError;
            }

            const duration = Number(existing.rows[0].duration_minutes) || 30;

            const overlap = await db.query(
                `
                    SELECT id
                    FROM appointments
                    WHERE id <> $1
                      AND date = $2
                      AND status IN ('confirmed', 'late')
                      AND time < ($3::time + make_interval(mins => $4::int))
                      AND $3::time < (time + make_interval(mins => COALESCE(duration_minutes, 30)::int))
                    LIMIT 1
                `,
                [appointmentId, date, time, duration]
            );

            if (overlap.rows.length > 0) {
                const lockError = new Error("Time slot already booked");
                lockError.statusCode = 409;
                throw lockError;
            }

            await db.query(
                `
                    UPDATE appointments
                    SET date = $1,
                        time = $2,
                        status = 'confirmed',
                        cancelled_at = NULL,
                        cancellation_fee_percent = 0,
                        no_show_fee_percent = 0
                    WHERE id = $3
                `,
                [date, time, appointmentId]
            );
        });

        return res.json({ success: true, date, time });
    } catch (error) {
        if (error?.statusCode === 404) {
            return res.status(404).json({ error: "Appointment not found" });
        }
        if (error?.statusCode === 409 || error?.code === "23505") {
            return res.status(409).json({ error: "Time slot already booked" });
        }
        return sendInternalError(res, "Admin reschedule error:", error);
    }
});

app.post("/api/admin/expenses", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
        const expenseDate = String(req.body?.date || "");
        const category = String(req.body?.category || "").trim();
        const description = String(req.body?.description || "").trim();
        const amount = Number(req.body?.amount);

        if (!isValidDate(expenseDate)) {
            return res.status(400).json({ error: "Valid date is required" });
        }

        if (!category) {
            return res.status(400).json({ error: "Category is required" });
        }

        if (!Number.isFinite(amount) || amount <= 0) {
            return res.status(400).json({ error: "Amount must be greater than 0" });
        }

        const amountCents = Math.round(amount * 100);

        const result = await pool.query(
            `
                INSERT INTO expenses (expense_date, category, description, amount_cents)
                VALUES ($1, $2, $3, $4)
                RETURNING id, expense_date::text AS date, category, description, amount_cents
            `,
            [expenseDate, category, description || null, amountCents]
        );

        return res.json({ success: true, expense: result.rows[0] });
    } catch (error) {
        return sendInternalError(res, "Admin expense create error:", error);
    }
});

app.delete("/api/admin/expenses/:id", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
        const expenseId = Number(req.params.id);

        if (!Number.isInteger(expenseId)) {
            return res.status(400).json({ error: "Invalid expense ID" });
        }

        const result = await pool.query(
            `
                DELETE FROM expenses
                WHERE id = $1
                RETURNING id
            `,
            [expenseId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Expense not found" });
        }

        return res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        return sendInternalError(res, "Admin expense delete error:", error);
    }
});

app.get("/api/admin/finance", requireAdmin, async (req, res) => {
    const range = resolveAnalyticsRange(req.query.start, req.query.end);

    if (!range) {
        return res.status(400).json({ error: "Invalid date range" });
    }

    try {
        const [appointmentsResult, expensesResult] = await Promise.all([
            pool.query(
                `
                    SELECT
                        id,
                        date::text AS date,
                        status,
                        COALESCE(price, 0)::int AS price,
                        COALESCE(cancellation_fee_percent, 0)::int AS cancellation_fee_percent,
                        COALESCE(no_show_fee_percent, 0)::int AS no_show_fee_percent
                    FROM appointments
                    WHERE date::text >= $1
                      AND date::text <= $2
                `,
                [range.start, range.end]
            ),
            pool.query(
                `
                    SELECT
                        id,
                        expense_date::text AS date,
                        category,
                        description,
                        COALESCE(amount_cents, 0)::int AS amount_cents
                    FROM expenses
                    WHERE expense_date::text >= $1
                      AND expense_date::text <= $2
                    ORDER BY expense_date DESC, created_at DESC
                `,
                [range.start, range.end]
            )
        ]);

        const appointments = appointmentsResult.rows || [];
        const expenses = expensesResult.rows || [];

        let confirmedRevenueCents = 0;
        let cancellationFeesCents = 0;
        let noShowFeesCents = 0;

        for (const appointment of appointments) {
            const price = Number(appointment.price) || 0;
            const status = String(appointment.status || "").toLowerCase();

            if (status === "confirmed" || status === "late") {
                confirmedRevenueCents += price;
            }

            if (status === "cancelled") {
                cancellationFeesCents += Math.round(price * ((Number(appointment.cancellation_fee_percent) || 0) / 100));
            }

            if (status === "no_show") {
                noShowFeesCents += Math.round(price * ((Number(appointment.no_show_fee_percent) || 0) / 100));
            }
        }

        const expensesCents = expenses.reduce(
            (sum, expense) => sum + (Number(expense.amount_cents) || 0),
            0
        );

        const grossRevenueCents = confirmedRevenueCents + cancellationFeesCents + noShowFeesCents;
        const netRevenueCents = grossRevenueCents - expensesCents;

        return res.json({
            range,
            totals: {
                confirmedRevenueCents,
                cancellationFeesCents,
                noShowFeesCents,
                grossRevenueCents,
                expensesCents,
                netRevenueCents
            },
            expenses
        });
    } catch (error) {
        return sendInternalError(res, "Admin finance error:", error);
    }
});

app.get("/api/admin/analytics", requireAdmin, async (req, res) => {
    const range = resolveAnalyticsRange(req.query.start, req.query.end);

    if (!range) {
        return res.status(400).json({ error: "Invalid date range" });
    }

    try {
        const result = await pool.query(
            `
                SELECT
                    date::text AS day,
                    status,
                    COALESCE(price, 0)::int AS price,
                    services
                FROM appointments
                WHERE date::text >= $1
                  AND date::text <= $2
                ORDER BY day ASC, created_at ASC
            `,
            [range.start, range.end]
        );

        const rows = result.rows || [];
        const dailyMap = new Map();
        const topServicesMap = new Map();

        let totalAppointments = 0;
        let confirmedAppointments = 0;
        let cancelledAppointments = 0;
        let confirmedRevenueCents = 0;

        for (let index = 0; index < range.days; index += 1) {
            const day = formatDateISO(addDays(new Date(range.start), index));
            dailyMap.set(day, {
                date: day,
                appointments: 0,
                confirmed: 0,
                cancelled: 0,
                revenueCents: 0
            });
        }

        for (const row of rows) {
            const day = row.day;
            const status = String(row.status || "").toLowerCase();
            const price = Number(row.price) || 0;
            const dayEntry = dailyMap.get(day);

            totalAppointments += 1;

            if (dayEntry) {
                dayEntry.appointments += 1;
            }

            if (status === "cancelled") {
                cancelledAppointments += 1;
                if (dayEntry) {
                    dayEntry.cancelled += 1;
                }
                continue;
            }

            confirmedAppointments += 1;
            confirmedRevenueCents += price;

            if (dayEntry) {
                dayEntry.confirmed += 1;
                dayEntry.revenueCents += price;
            }

            let services = [];
            try {
                const parsed = JSON.parse(row.services || "[]");
                services = Array.isArray(parsed) ? parsed : [];
            } catch (error) {
                services = [];
            }

            for (const service of services) {
                const name = String(service?.name || "").trim();
                const servicePrice = Number(service?.price) || 0;

                if (!name) {
                    continue;
                }

                const existing = topServicesMap.get(name) || {
                    name,
                    count: 0,
                    revenueCents: 0
                };

                existing.count += 1;
                existing.revenueCents += Math.round(servicePrice * 100);
                topServicesMap.set(name, existing);
            }
        }

        const avgTicketCents =
            confirmedAppointments > 0
                ? Math.round(confirmedRevenueCents / confirmedAppointments)
                : 0;

        const completionRate =
            totalAppointments > 0
                ? Number(((confirmedAppointments / totalAppointments) * 100).toFixed(1))
                : 0;

        const topServices = Array.from(topServicesMap.values())
            .sort((left, right) => {
                if (right.count !== left.count) {
                    return right.count - left.count;
                }
                return right.revenueCents - left.revenueCents;
            })
            .slice(0, 8);

        return res.json({
            range,
            totals: {
                appointments: totalAppointments,
                confirmed: confirmedAppointments,
                cancelled: cancelledAppointments,
                revenueCents: confirmedRevenueCents,
                avgTicketCents,
                completionRate
            },
            daily: Array.from(dailyMap.values()),
            topServices
        });
    } catch (err) {
        console.error("Admin analytics error:", err);
        return sendInternalError(res, "Admin analytics error:", err);
    }
});

app.get("/api/admin/appointments", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, TO_CHAR(time, 'HH24:MI') AS time,
                    COALESCE(duration_minutes, 30) AS duration_minutes, services, email, name, phone,
                    price, timezone, status, created_at,
                    wax_pass_id,
                    COALESCE(wax_pass_credit_forfeited, FALSE) AS wax_pass_credit_forfeited
             FROM appointments ORDER BY created_at DESC`
        );
        res.json(result.rows || []);
    } catch (err) {
        console.error("Admin query error:", err);
        return sendInternalError(res, "Admin appointments query error:", err);
    }
});

app.post("/api/admin/appointments/:id/cancel", requireAdmin, requireAdminCsrf, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ error: "Invalid appointment ID" });
        }

        const existing = await pool.query(
            `
                SELECT id, date::text AS date, TO_CHAR(time, 'HH24:MI') AS time, status, price,
                       stripe_payment_id, wax_pass_id
                FROM appointments
                WHERE id = $1
                LIMIT 1
            `,
            [appointmentId]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        const appointment = existing.rows[0];
        if (!["confirmed", "late"].includes(String(appointment.status || "").toLowerCase())) {
            return res.status(400).json({ error: "Only active appointments can be cancelled" });
        }

        const feePercent = calculateLateCancellationFeePercent(appointment.date, appointment.time);
        const settlement = await settleAppointmentPolicyWithStripe(
            appointment,
            feePercent,
            "admin_cancel"
        );
        const waxPassId = Number(appointment.wax_pass_id) || 0;
        let waxPassCreditForfeited = false;
        let waxPassCreditRestored = false;

        let result;
        if (waxPassId && feePercent > 0) {
            result = await pool.query(
                `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(),
                     cancellation_fee_percent = $1, no_show_fee_percent = 0,
                     wax_pass_credit_forfeited = TRUE
                 WHERE id = $2 AND status IN ('confirmed', 'late') RETURNING id`,
                [feePercent, appointmentId]
            );
            waxPassCreditForfeited = true;
        } else if (waxPassId && feePercent === 0) {
            result = await pool.query(
                `UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(),
                     cancellation_fee_percent = $1, no_show_fee_percent = 0,
                     wax_pass_credit_forfeited = FALSE
                 WHERE id = $2 AND status IN ('confirmed', 'late') RETURNING id`,
                [feePercent, appointmentId]
            );
            if ((result.rows || []).length > 0) {
                await pool.query(
                    `UPDATE wax_passes SET used_credits = GREATEST(0, used_credits - 1),
                         status = CASE WHEN status = 'completed' THEN 'active' ELSE status END
                     WHERE id = $1`,
                    [waxPassId]
                );
                waxPassCreditRestored = true;
            }
        } else {
            result = await pool.query(
                `
                    UPDATE appointments
                    SET status = 'cancelled',
                        cancelled_at = NOW(),
                        cancellation_fee_percent = $1,
                        no_show_fee_percent = 0
                    WHERE id = $2
                      AND status IN ('confirmed', 'late')
                    RETURNING id
                `,
                [feePercent, appointmentId]
            );
        }

        if (result.rows.length === 0) {
            return res.status(409).json({ error: "Appointment could not be cancelled" });
        }

        return res.json({
            success: true,
            id: result.rows[0].id,
            feePercent,
            settlement,
            isWaxPass: waxPassId > 0,
            waxPassCreditForfeited,
            waxPassCreditRestored
        });
    } catch (err) {
        console.error("Admin cancel error:", err);
        return sendInternalError(res, "Admin cancel error:", err);
    }
});

// ============================================================
// WAX PASS ROUTES
// ============================================================

// GET /api/wax-passes/tiers
app.get("/api/wax-passes/tiers", (req, res) => {
    res.json(
        Object.entries(WAX_PASS_TIERS).map(([tier, t]) => ({
            tier: Number(tier),
            paid: t.paid,
            free: t.free,
            total: t.total,
            label: t.label,
            discountPct: t.discountPct
        }))
    );
});

// GET /api/wax-passes/services?tier=N
app.get("/api/wax-passes/services", (req, res) => {
    const tier = Number(req.query.tier) || 1;
    if (![1, 2, 3].includes(tier)) return res.status(400).json({ error: "Invalid tier" });
    res.json(buildWaxPassCatalog(tier));
});

// GET /api/client/wax-passes
app.get("/api/client/wax-passes", requireClient, async (req, res) => {
    try {
        const clientId = req.clientAuth.clientId || req.clientAuth.id;
        const rows = await pool.query(
            `SELECT id, service_id, service_name, tier, total_credits, paid_credits,
                    used_credits, price_paid_cents, per_use_price_cents, status, created_at
             FROM wax_passes WHERE client_id = $1 ORDER BY created_at DESC`,
            [clientId]
        );
        res.json(rows.rows || []);
    } catch (err) {
        return sendInternalError(res, "Client wax passes error:", err);
    }
});

// POST /api/wax-passes/purchase — create Stripe checkout for wax pass bundle
app.post("/api/wax-passes/purchase", requireClient, requireCsrf, async (req, res) => {
    try {
        const { serviceId, tier, customer, consent } = req.body || {};
        const tierNum = Number(tier);
        if (![1, 2, 3].includes(tierNum)) return res.status(400).json({ error: "Invalid tier" });
        const customerName = String(customer?.name || "").trim();
        const consentAccepted = consent?.accepted === true;
        const consentSignature = String(consent?.signature || "").trim();
        if (!consentAccepted || consentSignature.length < 2) {
            return res.status(400).json({ error: "Consent form must be signed" });
        }
        if (!signatureMatchesBookingName(consentSignature, customerName)) {
            return res.status(400).json({ error: "Consent signature must match booking name" });
        }

        const tierInfo = WAX_PASS_TIERS[tierNum];
        const allowedIds = getWaxPassServiceIds(tierNum);
        if (!serviceId || !allowedIds.includes(serviceId)) {
            return res.status(400).json({ error: "Service not available for this tier" });
        }
        const svc = canonicalServicesById.get(serviceId);
        if (!svc) return res.status(400).json({ error: "Service not found" });
        const priceCents = Math.round(svc.price * 100);
        const totalPriceCents = priceCents * tierInfo.paid;
        const clientId = req.clientAuth.clientId || req.clientAuth.id;
        const customerEmail = normalizeEmail(customer?.email || req.clientAuth?.email || "");

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            mode: "payment",
            customer_email: customerEmail || undefined,
            line_items: [{
                price_data: {
                    currency: "usd",
                    product_data: {
                        name: `Wax Pass — ${svc.name} (${tierInfo.label})`,
                        description: `${tierInfo.total} credits (${tierInfo.paid} paid + ${tierInfo.free} free). Per-use value: $${svc.price.toFixed(2)}.`
                    },
                    unit_amount: totalPriceCents
                },
                quantity: 1
            }],
            metadata: {
                type: "wax_pass_purchase",
                clientId: String(clientId),
                serviceId,
                serviceName: svc.name,
                tier: String(tierNum),
                totalCredits: String(tierInfo.total),
                paidCredits: String(tierInfo.paid),
                pricePaidCents: String(totalPriceCents),
                perUsePriceCents: String(priceCents)
            },
            success_url: `${PUBLIC_APP_URL}/wax-pass-success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${PUBLIC_APP_URL}/wax-pass.html`
        });

        res.json({ url: session.url });
    } catch (err) {
        return sendInternalError(res, "Wax pass purchase error:", err);
    }
});

// POST /api/wax-passes/confirm-purchase — called after Stripe redirect, idempotent
app.post("/api/wax-passes/confirm-purchase", requireClient, requireCsrf, async (req, res) => {
    try {
        const { sessionId } = req.body || {};
        if (!sessionId) return res.status(400).json({ error: "Session ID required" });
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const clientId = req.clientAuth.clientId || req.clientAuth.id;
        const waxPass = await finalizeWaxPassPurchaseFromSession(session, clientId);
        res.json({ success: true, waxPass });
    } catch (err) {
        return sendInternalError(res, "Wax pass confirm error:", err);
    }
});

// POST /api/client/wax-passes/:passId/book
app.post("/api/client/wax-passes/:passId/book", requireClient, requireCsrf, async (req, res) => {
    try {
        const passId = Number(req.params.passId);
        if (!Number.isInteger(passId)) return res.status(400).json({ error: "Invalid pass ID" });
        const clientId = req.clientAuth.clientId || req.clientAuth.id;
        const { date, time, timezone, phone, consent } = req.body || {};
        const consentAccepted = consent?.accepted === true;
        const consentSignature = String(consent?.signature || "").trim();
        if (!consentAccepted || consentSignature.length < 2) {
            return res.status(400).json({ error: "Consent form must be signed" });
        }
        if (!isValidDate(date) || !isValidTime(time)) {
            return res.status(400).json({ error: "Valid date and time are required" });
        }

        const bookingResult = await withAppointmentLocks([getAppointmentDateLockKey(date)], async (db) => {
            const passRows = await db.query(
                `SELECT wp.*, c.name, c.email
                 FROM wax_passes wp JOIN clients c ON c.id = wp.client_id
                 WHERE wp.id = $1 AND wp.client_id = $2 FOR UPDATE`,
                [passId, clientId]
            );
            if (passRows.rows.length === 0) {
                const e = new Error("Wax pass not found"); e.statusCode = 404; throw e;
            }
            const pass = passRows.rows[0];
            if (pass.status !== "active") {
                const e = new Error("Wax pass is not active"); e.statusCode = 400; throw e;
            }
            if (!signatureMatchesBookingName(consentSignature, pass.name)) {
                const e = new Error("Consent signature must match booking name"); e.statusCode = 400; throw e;
            }
            const remainingCredits = pass.total_credits - pass.used_credits;
            if (remainingCredits <= 0) {
                const e = new Error("No credits remaining on this wax pass"); e.statusCode = 400; throw e;
            }

            const svc = canonicalServicesById.get(pass.service_id);
            const duration = svc ? (svc.duration || svc.durationMinutes || 30) : 30;
            const overlap = await db.query(
                `SELECT id FROM appointments
                 WHERE date = $1
                   AND time < ($2::time + ($3 * interval '1 minute'))
                   AND (time + (COALESCE(duration_minutes,30) * interval '1 minute')) > $2::time
                   AND status IN ('confirmed','late') LIMIT 1`,
                [date, time, duration]
            );
            if (overlap.rows.length > 0) {
                const e = new Error("Time slot already booked"); e.statusCode = 409; throw e;
            }

            const token = `WAXPASS-USE-${passId}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
            const appt = await db.query(
                `INSERT INTO appointments
                    (name, email, phone, services, date, time, timezone, price,
                     stripe_payment_id, status, duration_minutes, wax_pass_id)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'confirmed',$10,$11) RETURNING id`,
                [
                    pass.name, pass.email, phone || "",
                    JSON.stringify([
                        {
                            id: String(pass.service_id || ""),
                            name: String(pass.service_name || "Service"),
                            price: Number(pass.per_use_price_cents || 0) / 100,
                            duration: Number(duration) || 30
                        }
                    ]), date, time,
                    timezone || "America/Chicago",
                    (pass.per_use_price_cents || 0) / 100,
                    token, duration, passId
                ]
            );

            const newUsed = pass.used_credits + 1;
            const newStatus = newUsed >= pass.total_credits ? "completed" : "active";
            await db.query(
                "UPDATE wax_passes SET used_credits = $1, status = $2 WHERE id = $3",
                [newUsed, newStatus, passId]
            );
            return {
                appointmentId: appt.rows[0].id,
                name: pass.name, email: pass.email,
                serviceName: pass.service_name, date, time,
                remainingAfter: remainingCredits - 1
            };
        });

        try {
            await transporter.sendMail({
                from: process.env.EMAIL_FROM || `"Lunelia Aesthetics" <noreply@luneliaesthetics.com>`,
                to: bookingResult.email,
                subject: "Your Wax Pass Appointment is Confirmed!",
                html: `<p>Hi ${escapeHtml(bookingResult.name)},</p>
                       <p>Your wax pass appointment for <strong>${escapeHtml(bookingResult.serviceName)}</strong> on
                       <strong>${escapeHtml(bookingResult.date)}</strong> at <strong>${escapeHtml(bookingResult.time)}</strong> is confirmed.</p>
                       <p><strong>Cancellation Policy:</strong> Cancel more than 24 hours before your appointment to have
                       your wax pass credit returned. If you are late or no-show for an appointment booked with a wax
                       pass, that wax pass credit is considered spent and is non-refundable.</p>
                       <p>You have <strong>${escapeHtml(String(bookingResult.remainingAfter))}</strong> credit(s) remaining on this pass.</p>
                       <p>Thank you!</p>`
            });
        } catch (mailErr) {
            console.error("Wax pass booking email error:", mailErr);
        }

        sendInternalBookingNotification({
            source: "wax-pass-booking",
            appointmentId: bookingResult.appointmentId,
            date: bookingResult.date,
            time: bookingResult.time,
            name: bookingResult.name,
            email: bookingResult.email,
            phone: phone || "",
            services: [{ name: bookingResult.serviceName }],
            consentSignature
        }).catch((e) => {
            console.error("Internal booking notify error:", e);
        });

        res.json({
            success: true,
            appointmentId: bookingResult.appointmentId,
            remainingCredits: bookingResult.remainingAfter
        });
    } catch (err) {
        if (err?.statusCode === 404) return res.status(404).json({ error: err.message });
        if (err?.statusCode === 400) return res.status(400).json({ error: err.message });
        if (err?.statusCode === 409) return res.status(409).json({ error: err.message });
        return sendInternalError(res, "Wax pass book error:", err);
    }
});

// GET /api/admin/wax-passes
app.get("/api/admin/wax-passes", requireAdmin, async (req, res) => {
    try {
        const rows = await pool.query(
            `SELECT wp.id, wp.client_id, c.name AS client_name, c.email AS client_email,
                    wp.service_id, wp.service_name, wp.tier, wp.total_credits, wp.paid_credits,
                    wp.used_credits, wp.price_paid_cents, wp.per_use_price_cents,
                    wp.stripe_session_id, wp.stripe_payment_id, wp.status, wp.created_at
             FROM wax_passes wp LEFT JOIN clients c ON c.id = wp.client_id
             ORDER BY wp.created_at DESC`
        );
        res.json(rows.rows || []);
    } catch (err) {
        return sendInternalError(res, "Admin wax passes error:", err);
    }
});

app.use(
    express.static(path.join(__dirname), {
        dotfiles: "deny",
        extensions: ["html"]
    })
); // serve frontend

// Start server
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
