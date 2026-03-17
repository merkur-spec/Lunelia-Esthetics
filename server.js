require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const path = require("path");
const crypto = require("crypto");
const { serviceData } = require("./serviceData");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = "/api/webhook";
const jsonParser = express.json({ limit: "1mb" });
const CLIENT_TOKEN_SECRET = process.env.CLIENT_TOKEN_SECRET || "change-this-client-token-secret";
const PUBLIC_APP_URL = process.env.FRONTEND_URL || process.env.DOMAIN || "http://localhost:5500";

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

if (corsOrigins.length > 0) {
    app.use(cors({ origin: corsOrigins }));
} else if (process.env.NODE_ENV !== "production") {
    app.use(cors({ origin: true }));
}

app.use(helmet({ contentSecurityPolicy: false }));
app.use(
    rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 300,
        standardHeaders: true,
        legacyHeaders: false
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
            ? { rejectUnauthorized: false }
            : undefined
});

if (!process.env.DATABASE_URL) {
    console.warn("DATABASE_URL is not set. Database connections will fail.");
}

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
});

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
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS reset_password_token_hash TEXT"
        );
        await pool.query(
            "ALTER TABLE clients ADD COLUMN IF NOT EXISTS reset_password_expires_at TIMESTAMP"
        );
        await pool.query(
            "UPDATE appointments SET duration_minutes = 30 WHERE duration_minutes IS NULL"
        );

        await migrateAppointmentDateTimeColumns();

        console.log("Connected to PostgreSQL and tables initialized");
    } catch (err) {
        console.error("Database initialization error:", err);
    }
}

// Initialize on startup
initializeDatabase();

// Setup email transporter (update with your email credentials)
const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    }
});

function isValidDate(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function isValidTime(value) {
    return /^\d{2}:\d{2}$/.test(value);
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

function getServicesTotalDuration(services) {
    return services.reduce((sum, service) => sum + service.duration, 0);
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

function getAdminCredentials() {
    return {
        user: process.env.ADMIN_USER || "",
        pass: process.env.ADMIN_PASS || ""
    };
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
    const hash = crypto.scryptSync(password, salt, 64).toString("hex");
    return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(originalHash, "hex"));
}

function createClientToken(client) {
    const payload = Buffer.from(
        JSON.stringify({
            id: client.id,
            email: normalizeEmail(client.email),
            exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30
        })
    ).toString("base64url");

    const signature = crypto
        .createHmac("sha256", CLIENT_TOKEN_SECRET)
        .update(payload)
        .digest("base64url");

    return `${payload}.${signature}`;
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

    if (signature !== expectedSignature) {
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

function requireClient(req, res, next) {
    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Bearer ")) {
        return res.status(401).json({ error: "Client authentication required" });
    }

    const token = authHeader.replace("Bearer ", "").trim();
    const payload = verifyClientToken(token);

    if (!payload) {
        return res.status(401).json({ error: "Invalid or expired session" });
    }

    req.clientAuth = payload;
    return next();
}

function requireAdmin(req, res, next) {
    const { user, pass } = getAdminCredentials();
    if (!user || !pass) {
        return res.status(503).json({ error: "Admin access not configured" });
    }

    const authHeader = req.headers.authorization || "";
    if (!authHeader.startsWith("Basic ")) {
        res.set("WWW-Authenticate", "Basic");
        return res.status(401).json({ error: "Unauthorized" });
    }

    const decoded = Buffer.from(authHeader.replace("Basic ", ""), "base64")
        .toString("utf8")
        .split(":");

    if (decoded.length !== 2 || decoded[0] !== user || decoded[1] !== pass) {
        return res.status(403).json({ error: "Forbidden" });
    }

    return next();
}

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
            "SELECT TO_CHAR(date, 'YYYY-MM-DD') AS date, TO_CHAR(time, 'HH24:MI') AS time, COALESCE(duration_minutes, 30) AS duration_minutes FROM appointments WHERE stripe_payment_id IS NOT NULL AND status = 'confirmed'";

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
        res.status(500).json({ error: err.message });
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
        const consentAccepted = consent?.accepted === true;
        const consentSignature = String(consent?.signature || "").trim();

        if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
        }

        if (!consentAccepted || consentSignature.length < 2) {
            return res.status(400).json({ error: "Consent form must be signed" });
        }

        if (referralEmail && !/^\S+@\S+\.\S+$/.test(referralEmail)) {
            return res.status(400).json({ error: "Referral email is invalid" });
        }

        if (!isValidDate(date) || !isValidTime(time) || !sanitizedServices) {
            return res.status(400).json({ error: "Missing or invalid fields" });
        }

        const expectedAmount =
            sanitizedServices.reduce((sum, service) => sum + service.price, 0) * 100;
        const requestedDuration = getServicesTotalDuration(sanitizedServices);

        if (!Number.isInteger(requestedDuration) || requestedDuration <= 0) {
            return res.status(400).json({ error: "Invalid service duration" });
        }

        if (parsedAmount !== expectedAmount) {
            return res.status(400).json({ error: "Amount does not match services" });
        }

        const conflict = await pool.query(
            `
                SELECT id
                FROM appointments
                WHERE date = $1
                  AND status = 'confirmed'
                  AND time < ($2::time + make_interval(mins => $3::int))
                  AND $2::time < (time + make_interval(mins => COALESCE(duration_minutes, 30)::int))
                LIMIT 1
            `,
            [date, time, requestedDuration]
        );
        if (conflict.rows.length > 0) {
            return res.status(409).json({ error: "Time slot already booked" });
        }
        
        // Create Stripe Checkout Session
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ["card"],
            line_items: [
                {
                    price_data: {
                        currency: "usd",
                        product_data: {
                            name: "Lunelia Esthetics Booking",
                            description: sanitizedServices.map((service) => service.name).join(", ")
                        },
                        unit_amount: parsedAmount
                    },
                    quantity: 1
                }
            ],
            mode: "payment",
            success_url: `${process.env.DOMAIN || "http://localhost:" + PORT}/success.html?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${process.env.DOMAIN || "http://localhost:" + PORT}/booking.html`,
            metadata: {
                date,
                time,
                durationMinutes: String(requestedDuration),
                services: JSON.stringify(sanitizedServices),
                name: customerName,
                email: customerEmail,
                phone: customerPhone,
                referralEmail,
                timezone,
                consentAccepted: String(consentAccepted),
                consentSignature
            },
            customer_email: customerEmail || undefined
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
        res.status(500).json({ error: error.message });
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
            consentSignature
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

        let clientId = null;
        if (appointmentEmail) {
            const clientLookup = await pool.query(
                "SELECT id FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1",
                [appointmentEmail]
            );
            clientId = clientLookup.rows[0]?.id || null;
        }

        const existing = await pool.query(
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

            return res.json({
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
            });
        }
        const overlap = await pool.query(
            `
                SELECT id
                FROM appointments
                WHERE date = $1
                  AND status = 'confirmed'
                  AND time < ($2::time + make_interval(mins => $3::int))
                  AND $2::time < (time + make_interval(mins => COALESCE(duration_minutes, 30)::int))
                LIMIT 1
            `,
            [date, time, appointmentDuration]
        );

        if (overlap.rows.length > 0) {
            return res.status(409).json({ error: "Time slot already booked" });
        }

        // Insert appointment
        try {
            const result = await pool.query(
                "INSERT INTO appointments (date, time, duration_minutes, services, email, name, phone, price, stripe_payment_id, timezone, client_id, consent_signature, consent_accepted_at, referred_by_email) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), $13) RETURNING id",
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
                    referredByEmail || null
                ]
            );

            const appointmentId = result.rows[0].id;

            // Send confirmation email
            if (appointmentEmail && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                try {
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: appointmentEmail,
                        subject: "Booking Confirmation - Lunelia Esthetics",
                        html: `
                            <h2>Your Booking is Confirmed!</h2>
                            <p>Hi ${appointmentName || "Valued Client"},</p>
                            <p>Thank you for booking with Lunelia Esthetics. Here are your appointment details:</p>
                            <p><strong>Date:</strong> ${date}</p>
                            <p><strong>Time:</strong> ${time}</p>
                            <p><strong>Services:</strong> ${servicesList.map((service) => service.name).join(", ")}</p>
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
                    });
                } catch (emailError) {
                    console.error("Email Error:", emailError);
                }
            }

            // Update payment status
            await pool.query(
                "UPDATE payments SET status = $1, stripe_payment_intent_id = $2 WHERE stripe_session_id = $3",
                ["completed", session.payment_intent, sessionId]
            );

            res.json({
                success: true,
                appointmentId,
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
            });
        } catch (dbErr) {
            console.error("DB Error:", dbErr);
            if (dbErr.code === "23505") {
                return res.status(409).json({ error: "Time slot already booked" });
            }
            res.status(500).json({ error: dbErr.message });
        }
    } catch (error) {
        console.error("Error:", error);
        res.status(500).json({ error: error.message });
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
            "INSERT INTO clients (name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, name, email",
            [name || null, email, hashPassword(password)]
        );

        const client = result.rows[0];

        if (client?.email && process.env.EMAIL_USER && process.env.EMAIL_PASS) {
            try {
                await transporter.sendMail({
                    from: process.env.EMAIL_USER,
                    to: client.email,
                    subject: "Your Lunelia Esthetics Account Is Ready",
                    html: `
                        <h2>Welcome to Lunelia Esthetics</h2>
                        <p>Hi ${client.name || "there"},</p>
                        <p>Your client account has been created successfully.</p>
                        <p>You can sign in anytime to manage your bookings.</p>
                        <p><a href="${PUBLIC_APP_URL}/client.html">Sign in to your client portal</a></p>
                    `
                });
            } catch (emailError) {
                console.error("Account email error:", emailError);
            }
        }

        return res.json({
            success: true,
            token: createClientToken(client),
            client
        });
    } catch (error) {
        if (error.code === "23505") {
            return res.status(409).json({ error: "Account already exists for this email" });
        }
        return res.status(500).json({ error: error.message });
    }
});

app.post("/api/client/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || "");
        const password = String(req.body?.password || "");

        const result = await pool.query(
            "SELECT id, name, email, password_hash FROM clients WHERE LOWER(email) = LOWER($1) LIMIT 1",
            [email]
        );

        const client = result.rows[0];
        if (!client || !verifyPassword(password, client.password_hash)) {
            return res.status(401).json({ error: "Invalid email or password" });
        }

        return res.json({
            success: true,
            token: createClientToken(client),
            client: {
                id: client.id,
                email: client.email,
                name: client.name
            }
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post("/api/client/forgot-password", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || "");

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

            await pool.query(
                "UPDATE clients SET reset_password_token_hash = $1, reset_password_expires_at = $2 WHERE id = $3",
                [tokenHash, expiry, client.id]
            );

            if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
                try {
                    const resetLink = `${PUBLIC_APP_URL}/reset-password.html?token=${encodeURIComponent(rawToken)}&email=${encodeURIComponent(email)}`;
                    await transporter.sendMail({
                        from: process.env.EMAIL_USER,
                        to: email,
                        subject: "Reset Your Lunelia Esthetics Password",
                        html: `
                            <h2>Password Reset Request</h2>
                            <p>Hi ${client.name || "there"},</p>
                            <p>Use the link below to reset your password. This link expires in 1 hour.</p>
                            <p><a href="${resetLink}">Reset Password</a></p>
                        `
                    });
                } catch (emailError) {
                    console.error("Password reset email error:", emailError);
                }
            }
        }

        return res.json({
            success: true,
            message: "If an account exists for this email, a reset link has been sent."
        });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post("/api/client/reset-password", async (req, res) => {
    try {
        const email = normalizeEmail(req.body?.email || "");
        const token = String(req.body?.token || "").trim();
        const password = String(req.body?.password || "");

        if (!email || !token) {
            return res.status(400).json({ error: "Email and token are required" });
        }

        if (password.length < 8) {
            return res.status(400).json({ error: "Password must be at least 8 characters" });
        }

        const tokenHash = hashResetToken(token);
        const result = await pool.query(
            `
                SELECT id
                FROM clients
                WHERE LOWER(email) = LOWER($1)
                  AND reset_password_token_hash = $2
                  AND reset_password_expires_at IS NOT NULL
                  AND reset_password_expires_at > NOW()
                LIMIT 1
            `,
            [email, tokenHash]
        );

        const client = result.rows[0];
        if (!client) {
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
        return res.status(500).json({ error: error.message });
    }
});

app.get("/api/client/appointments", requireClient, async (req, res) => {
    try {
        const email = normalizeEmail(req.clientAuth?.email || "");

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
                ORDER BY date DESC, time DESC
            `,
            [email]
        );

        return res.json(result.rows || []);
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post("/api/client/appointments/:id/reschedule", requireClient, async (req, res) => {
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

        const existing = await pool.query(
            `
                SELECT id, COALESCE(duration_minutes, 30) AS duration_minutes
                FROM appointments
                WHERE id = $1
                  AND LOWER(email) = LOWER($2)
                  AND status = 'confirmed'
                LIMIT 1
            `,
            [appointmentId, email]
        );

        if (existing.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        const duration = Number(existing.rows[0].duration_minutes) || 30;

        const overlap = await pool.query(
            `
                SELECT id
                FROM appointments
                WHERE id <> $1
                  AND date = $2
                  AND status = 'confirmed'
                  AND time < ($3::time + make_interval(mins => $4::int))
                  AND $3::time < (time + make_interval(mins => COALESCE(duration_minutes, 30)::int))
                LIMIT 1
            `,
            [appointmentId, date, time, duration]
        );

        if (overlap.rows.length > 0) {
            return res.status(409).json({ error: "Time slot already booked" });
        }

        await pool.query(
            "UPDATE appointments SET date = $1, time = $2 WHERE id = $3",
            [date, time, appointmentId]
        );

        return res.json({ success: true, date, time });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post("/api/client/appointments/:id/cancel", requireClient, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        const email = normalizeEmail(req.clientAuth?.email || "");

        const result = await pool.query(
            `
                SELECT id, date::text AS date, TO_CHAR(time, 'HH24:MI') AS time, status
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
        if (appointment.status !== "confirmed") {
            return res.status(400).json({ error: "Only confirmed appointments can be cancelled" });
        }

        const appointmentStart = new Date(`${appointment.date}T${appointment.time}:00`);
        const hoursUntil = (appointmentStart.getTime() - Date.now()) / (1000 * 60 * 60);
        const feePercent = hoursUntil < 24 ? 30 : 0;

        await pool.query(
            "UPDATE appointments SET status = 'cancelled', cancelled_at = NOW(), cancellation_fee_percent = $1 WHERE id = $2",
            [feePercent, appointmentId]
        );

        return res.json({ success: true, feePercent });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post("/api/admin/appointments/:id/no-show", requireAdmin, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ error: "Invalid appointment ID" });
        }

        const result = await pool.query(
            "UPDATE appointments SET status = 'no_show', no_show_fee_percent = 50 WHERE id = $1 RETURNING id",
            [appointmentId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        return res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post("/api/admin/appointments/:id/reverse-no-show", requireAdmin, async (req, res) => {
    try {
        const appointmentId = Number(req.params.id);
        if (!Number.isInteger(appointmentId)) {
            return res.status(400).json({ error: "Invalid appointment ID" });
        }

        const result = await pool.query(
            `
                UPDATE appointments
                SET status = 'confirmed',
                    no_show_fee_percent = 0
                WHERE id = $1
                  AND status = 'no_show'
                RETURNING id
            `,
            [appointmentId]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: "Only no-show appointments can be reversed" });
        }

        return res.json({ success: true, id: result.rows[0].id });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
});

app.post("/api/admin/expenses", requireAdmin, async (req, res) => {
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
        return res.status(500).json({ error: error.message });
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

            if (status === "confirmed") {
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
        return res.status(500).json({ error: error.message });
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
        return res.status(500).json({ error: err.message });
    }
});

app.get("/api/admin/appointments", requireAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            "SELECT id, TO_CHAR(date, 'YYYY-MM-DD') AS date, TO_CHAR(time, 'HH24:MI') AS time, services, email, name, phone, price, timezone, status, created_at FROM appointments ORDER BY created_at DESC"
        );
        res.json(result.rows || []);
    } catch (err) {
        console.error("Admin query error:", err);
        res.status(500).json({ error: err.message });
    }
});

app.post("/api/admin/appointments/:id/cancel", requireAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query(
            "UPDATE appointments SET status = 'cancelled' WHERE id = $1 RETURNING id",
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Appointment not found" });
        }

        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error("Admin cancel error:", err);
        res.status(500).json({ error: err.message });
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
