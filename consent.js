const PENDING_BOOKING_KEY = "pendingBookingDraft";
const form = document.getElementById("consent-form");
const signatureInput = document.getElementById("consent-signature");
const acceptedInput = document.getElementById("consent-accepted");
const submitButton = document.getElementById("consent-submit");
const consentMessage = document.getElementById("consent-message");

let stripe = null;

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

    submitButton.disabled = true;
    submitButton.textContent = "Processing...";
    submitButton.setAttribute("aria-busy", "true");

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

    initStripe().catch((error) => {
        setMessage(error.message || "Payment system unavailable.");
        if (submitButton) {
            submitButton.disabled = true;
        }
    });
})();
