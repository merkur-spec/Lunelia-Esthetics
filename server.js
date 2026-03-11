require("dotenv").config();
const express = require("express");
const { Pool } = require("pg");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const nodemailer = require("nodemailer");
const path = require("path");
const { serviceData } = require("./serviceData");

const app = express();
const PORT = process.env.PORT || 3000;
const WEBHOOK_PATH = "/api/webhook";
const jsonParser = express.json({ limit: "1mb" });

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
        const { amount, date, time, services, customer } = req.body;
        
        const sanitizedServices = sanitizeServices(services);
        const parsedAmount = Number(amount);
        const customerName = customer?.name?.trim() || "";
        const customerEmail = customer?.email?.trim() || "";
        const customerPhone = customer?.phone?.trim() || "";
        const timezone = customer?.timezone?.trim() || "";

        if (!Number.isInteger(parsedAmount) || parsedAmount <= 0) {
            return res.status(400).json({ error: "Invalid amount" });
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
                timezone
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
            timezone
        } =
            session.metadata || {};

        if (!isValidDate(date) || !isValidTime(time) || !services) {
            return res.status(400).json({ error: "Missing booking metadata" });
        }

        const appointmentEmail = (email || metaEmail || session.customer_details?.email || "").trim();
        const appointmentName = (name || metaName || "").trim();
        const appointmentPhone = (phone || metaPhone || "").trim();
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
                "INSERT INTO appointments (date, time, duration_minutes, services, email, name, phone, price, stripe_payment_id, timezone) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id",
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
                    timezone || null
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
