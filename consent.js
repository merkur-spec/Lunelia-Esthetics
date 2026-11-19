const PENDING_BOOKING_KEY = "pendingBookingDraft";
const form = document.getElementById("consent-form");
const signatureInput = document.getElementById("consent-signature");
const acceptedInput = document.getElementById("consent-accepted");
const submitButton = document.getElementById("consent-submit");
const consentMessage = document.getElementById("consent-message");
const formsContainer = document.getElementById("consent-forms");
const signingSection = document.getElementById("consent-signing");

let stripe = null;
let formsToSign = [];
let formsLoaded = false;
let signableForms = [];

function formatDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

function isItemVisible(item, answers) {
    if (!item.showIf) {
        return true;
    }

    const value = answers[item.showIf.field];
    if (item.showIf.includes !== undefined) {
        return Array.isArray(value) && value.includes(item.showIf.includes);
    }
    return value === item.showIf.equals;
}

function addTextBlock(parent, tag, text) {
    const element = document.createElement(tag);
    element.textContent = text;
    parent.appendChild(element);
    return element;
}

function buildOptionInputs(wrapper, inputType, name, options) {
    for (const option of options) {
        const label = document.createElement("label");
        label.className = "consent-option";
        const input = document.createElement("input");
        input.type = inputType;
        input.name = name;
        input.value = option;
        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${option}`));
        wrapper.appendChild(label);
    }
}

function buildItemElement(formType, item) {
    const wrapper = document.createElement("div");
    wrapper.className = `consent-item consent-item-${item.type}`;

    if (item.type === "info") {
        if (item.heading) {
            addTextBlock(wrapper, "h5", item.heading);
        }
        for (const paragraph of item.paragraphs || []) {
            addTextBlock(wrapper, "p", paragraph);
        }
        if (item.list?.length) {
            const list = document.createElement("ul");
            for (const entry of item.list) {
                addTextBlock(list, "li", entry);
            }
            wrapper.appendChild(list);
        }
        return wrapper;
    }

    const name = `${formType}__${item.id}`;
    wrapper.dataset.itemId = item.id;

    if (item.type === "agree") {
        const label = document.createElement("label");
        label.className = "consent-option";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.name = name;
        label.appendChild(input);
        label.appendChild(document.createTextNode(` ${item.label}${item.required ? " *" : ""}`));
        wrapper.appendChild(label);
        return wrapper;
    }

    const question = document.createElement("label");
    question.className = "consent-question";
    question.textContent = `${item.label}${item.required ? " *" : ""}`;
    wrapper.appendChild(question);

    if (item.type === "text") {
        const input = document.createElement(item.multiline ? "textarea" : "input");
        input.name = name;
        input.id = name;
        question.htmlFor = name;
        if (item.multiline) {
            input.rows = 3;
            input.maxLength = 1000;
        } else if (item.inputType === "number") {
            input.type = "number";
            input.min = "1";
            input.max = "120";
        } else {
            input.type = "text";
            input.maxLength = 1000;
        }
        wrapper.appendChild(input);
    } else {
        buildOptionInputs(wrapper, item.type === "single" ? "radio" : "checkbox", name, item.options);
    }

    return wrapper;
}

// Reads the current answers from the DOM and shows/hides conditional questions.
function syncForm(block, formDef) {
    const answers = {};

    for (const item of formDef.items) {
        if (item.type === "info") {
            continue;
        }

        const element = block.querySelector(`[data-item-id="${item.id}"]`);
        const visible = isItemVisible(item, answers);
        if (element) {
            element.hidden = !visible;
        }
        if (!visible || !element) {
            continue;
        }

        if (item.type === "text") {
            answers[item.id] = element.querySelector("input, textarea").value.trim();
        } else if (item.type === "single") {
            answers[item.id] = element.querySelector("input:checked")?.value || "";
        } else if (item.type === "multi") {
            answers[item.id] = Array.from(element.querySelectorAll("input:checked")).map((input) => input.value);
        } else if (item.type === "agree") {
            answers[item.id] = element.querySelector("input").checked;
        }
    }

    return answers;
}

function findIncompleteItem(formDef, answers) {
    for (const item of formDef.items) {
        if (item.type === "info" || !isItemVisible(item, answers)) {
            continue;
        }

        const value = answers[item.id];
        let missing = false;
        if (item.type === "text" && item.inputType === "number") {
            const age = Number(value);
            missing = !Number.isInteger(age) || age < 1 || age > 120;
        } else if (item.required) {
            missing = item.type === "multi" ? !value?.length : item.type === "agree" ? value !== true : !value;
        }

        if (missing) {
            return item;
        }
    }
    return null;
}

function renderConsentForms(forms) {
    formsContainer.textContent = "";
    signableForms = [];

    for (const formDef of forms) {
        const section = document.createElement("section");
        section.className = "consent-form-block";
        addTextBlock(section, "h4", formDef.title);

        if (formDef.onFile) {
            addTextBlock(
                section,
                "p",
                `Signed on ${formatDate(formDef.signedAt)}. Valid until ${formatDate(formDef.validUntil)}.`
            );
        } else {
            for (const item of formDef.items || []) {
                section.appendChild(buildItemElement(formDef.type, item));
            }
            section.addEventListener("input", () => syncForm(section, formDef));
            section.addEventListener("change", () => syncForm(section, formDef));
            signableForms.push({ formDef, section });
            syncForm(section, formDef);
        }

        formsContainer.appendChild(section);
    }
}

async function loadConsentForms(pendingBooking) {
    const response = await fetch("/api/consent/required", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            email: pendingBooking?.customer?.email || "",
            services: pendingBooking?.services || []
        })
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(data?.error || "Unable to load consent forms.");
    }

    const forms = Array.isArray(data?.forms) ? data.forms : [];
    formsToSign = forms.filter((form) => !form.onFile).map((form) => form.type);
    renderConsentForms(forms);

    if (signingSection) {
        signingSection.hidden = formsToSign.length === 0;
    }
    formsLoaded = true;
}

function collectFormAnswers() {
    const answers = {};
    for (const { formDef, section } of signableForms) {
        answers[formDef.type] = syncForm(section, formDef);
    }
    return answers;
}

function findFirstIncompleteForm(answersByType) {
    for (const { formDef } of signableForms) {
        const item = findIncompleteItem(formDef, answersByType[formDef.type]);
        if (item) {
            return `Please complete: ${item.label} (${formDef.title})`;
        }
    }
    return "";
}

function buildConsentPayload(signature, answers) {
    return { accepted: formsToSign.length > 0, signature, forms: formsToSign, answers };
}

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
    if (!formsLoaded) {
        setMessage("Consent forms are still loading. Please try again in a moment.");
        return;
    }

    const bookingName = String(pendingBooking?.customer?.name || "").trim();
    if (formsToSign.length > 0) {
        const incompleteMessage = findFirstIncompleteForm(collectFormAnswers());
        if (incompleteMessage) {
            setMessage(incompleteMessage);
            return;
        }

        if (!signature || signature.length < 2 || !acceptedInput?.checked) {
            setMessage("Please sign and accept the consent form before continuing.");
            return;
        }

        if (!signatureMatchesBookingName(signature, bookingName)) {
            setMessage("Consent signature must match the name used on the booking form.");
            return;
        }
    }

    const consent = buildConsentPayload(signature, collectFormAnswers());

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
                    consent
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
                    consent
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
                    consent
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
                consent
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

    loadConsentForms(pendingBooking).catch((error) => {
        setMessage(error.message || "Unable to load consent forms.");
        if (submitButton) {
            submitButton.disabled = true;
        }
    });

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
