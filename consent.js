const PENDING_BOOKING_KEY = "pendingBookingDraft";
const form = document.getElementById("consent-form");
const signatureInput = document.getElementById("consent-signature");
const acceptedInput = document.getElementById("consent-accepted");
const submitButton = document.getElementById("consent-submit");
const consentMessage = document.getElementById("consent-message");

let stripe = null;

function getCookie(name) {
    const cookies = document.cookie ? document.cookie.split(";") : [];
    for (const cookie of cookies) {
        const [rawKey, ...rawValueParts] = cookie.split("=");
        const key = decodeURIComponent(String(rawKey || "").trim());
        if (key === name) {
            return decodeURIComponent(rawValueParts.join("=").trim());
        }
    }
    return "";
}

function getClientCsrfToken() {
    return getCookie("clientCsrf");
}

function setMessage(text) {
    if (consentMessage) {
        consentMessage.textContent = text;
    }
}

function getPendingBooking() {
    try {
        const raw = localStorage.getItem(PENDING_BOOKING_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch (error) {
        return null;
    }
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

async function initStripe() {
    const response = await fetch("/api/stripe-public-key");
    const data = await response.json().catch(() => null);

    if (!response.ok) {
        throw new Error(data?.error || "Stripe configuration error");
    }

    stripe = Stripe(data.publicKey);
}

form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const pendingBooking = getPendingBooking();
    if (!pendingBooking) {
        setMessage("Booking details expired. Please start again from the booking page.");
        return;
    }

    const signature = signatureInput?.value?.trim() || "";
    if (!signature || signature.length < 2 || !acceptedInput?.checked) {
        setMessage("Please sign and accept the consent form before continuing.");
        return;
    }

    const bookingName = String(pendingBooking?.customer?.name || "").trim();
    if (!signatureMatchesBookingName(signature, bookingName)) {
        setMessage("Consent signature must match the name used on the booking form.");
        return;
    }

    submitButton.disabled = true;
    submitButton.textContent = "Processing...";
    submitButton.setAttribute("aria-busy", "true");

    // --- Free booking (loyalty Wax Pass) path ---
    if (pendingBooking.isFree) {
        try {
            const response = await fetch("/api/free-booking", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: pendingBooking.date,
                    time: pendingBooking.time,
                    services: pendingBooking.services,
                    customer: pendingBooking.customer,
                    consent: { accepted: true, signature }
                })
            });

            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || "Free booking failed");
            }

            // Store the result so success.html can read it
            localStorage.setItem("freeBookingResult", JSON.stringify(data));
            window.location.href = "success.html?free=1";
        } catch (error) {
            setMessage(error.message || "Unable to complete free booking.");
            submitButton.disabled = false;
            submitButton.textContent = "Confirm Free Booking";
            submitButton.removeAttribute("aria-busy");
        }
        return;
    }

    // --- Wax pass credit booking path ---
    if (pendingBooking.isWaxPassBooking) {
        try {
            const passId = Number(pendingBooking?.waxPassSelection?.passId || 0);
            if (!passId) {
                throw new Error("Wax pass details are missing. Please start again from your client dashboard.");
            }

            const response = await fetch(`/api/client/wax-passes/${passId}/book`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    ...(getClientCsrfToken() ? { "X-CSRF-Token": getClientCsrfToken() } : {})
                },
                credentials: "include",
                body: JSON.stringify({
                    date: pendingBooking.date,
                    time: pendingBooking.time,
                    timezone: pendingBooking?.customer?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
                    phone: pendingBooking?.customer?.phone || "",
                    consent: { accepted: true, signature }
                })
            });

            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || "Wax pass booking failed");
            }

            const remainingCredits = Number(data?.remainingCredits);

            localStorage.setItem("waxPassBookingResult", JSON.stringify({
                appointment: {
                    name: pendingBooking?.customer?.name || "Client",
                    date: pendingBooking.date,
                    time: pendingBooking.time,
                    services: pendingBooking.services || []
                },
                remainingCredits: Number.isFinite(remainingCredits) ? remainingCredits : null
            }));

            window.location.href = "success.html?waxpass=1";
        } catch (error) {
            setMessage(error.message || "Unable to complete wax pass booking.");
            submitButton.disabled = false;
            submitButton.textContent = "Confirm Wax Pass Booking";
            submitButton.removeAttribute("aria-busy");
        }
        return;
    }

    // --- Wax pass purchase path ---
    if (pendingBooking.isWaxPassPurchase) {
        try {
            const tier = Number(pendingBooking?.waxPassPurchase?.tier || 0);
            const serviceId = String(pendingBooking?.waxPassPurchase?.serviceId || "").trim();
            if (![1, 2, 3].includes(tier) || !serviceId) {
                throw new Error("Wax pass details are missing. Please return to the wax pass page.");
            }

            const csrfToken = getClientCsrfToken();
            const response = await fetch("/api/wax-passes/purchase", {
                method: "POST",
                credentials: "include",
                headers: {
                    "Content-Type": "application/json",
                    ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {})
                },
                body: JSON.stringify({
                    tier,
                    serviceId,
                    customer: {
                        name: String(pendingBooking?.customer?.name || "").trim(),
                        email: String(pendingBooking?.customer?.email || "").trim(),
                        phone: String(pendingBooking?.customer?.phone || "").trim()
                    },
                    consent: { accepted: true, signature }
                })
            });

            const data = await response.json().catch(() => null);
            if (!response.ok) {
                throw new Error(data?.error || "Unable to continue to payment.");
            }
            if (!data?.url) {
                throw new Error("Unable to start payment checkout.");
            }

            window.location.href = data.url;
        } catch (error) {
            setMessage(error.message || "Unable to continue to payment.");
            submitButton.disabled = false;
            submitButton.textContent = "Continue to Payment";
            submitButton.removeAttribute("aria-busy");
        }
        return;
    }

    // --- Standard Stripe payment path ---
    try {
        if (!stripe) {
            await initStripe();
        }

        const response = await fetch("/api/create-payment-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                ...pendingBooking,
                consent: {
                    accepted: true,
                    signature
                }
            })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Payment failed");
        }

        const result = await stripe.redirectToCheckout({
            sessionId: data.sessionId
        });

        if (result.error) {
            throw new Error(result.error.message || "Unable to redirect to payment");
        }
    } catch (error) {
        setMessage(error.message || "Unable to continue to payment.");
        submitButton.disabled = false;
        submitButton.textContent = "Continue to Payment";
        submitButton.removeAttribute("aria-busy");
    }
});

(function init() {
    const pendingBooking = getPendingBooking();

    if (!pendingBooking) {
        setMessage("No booking draft found. Please select services and appointment details first.");
        if (submitButton) {
            submitButton.disabled = true;
        }
        return;
    }

    if (pendingBooking.isFree) {
        if (submitButton) {
            submitButton.textContent = "Confirm Free Booking";
        }
        // No Stripe needed for free bookings
        return;
    }

    if (pendingBooking.isWaxPassBooking) {
        if (submitButton) {
            submitButton.textContent = "Confirm Wax Pass Booking";
        }
        return;
    }

    if (pendingBooking.isWaxPassPurchase) {
        if (submitButton) {
            submitButton.textContent = "Continue to Payment";
        }
        return;
    }

    initStripe().catch((error) => {
        setMessage(error.message || "Payment system unavailable.");
        if (submitButton) {
            submitButton.disabled = true;
        }
    });
})();
