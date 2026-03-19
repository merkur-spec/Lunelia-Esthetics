const queryParams = new URLSearchParams(window.location.search);

function normalizeApiBase(value) {
    if (!value) {
        return "";
    }

    try {
        const parsed = new URL(value);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return "";
        }

        return `${parsed.protocol}//${parsed.host}`;
    } catch (error) {
        return "";
    }
}

const API_BASE_FROM_LINK = normalizeApiBase((queryParams.get("api") || "").trim());

const API_BASES = (() => {
    const bases = [];
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

    if (API_BASE_FROM_LINK) {
        bases.push(API_BASE_FROM_LINK);
    }

    if (isLocal) {
        [
            "http://localhost:3001",
            "http://127.0.0.1:3001",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            ""
        ].forEach((base) => {
            if (!bases.includes(base)) {
                bases.push(base);
            }
        });
    } else {
        bases.push("");
    }

    return bases;
})();
const forgotForm = document.getElementById("forgot-password-form");
const resetForm = document.getElementById("reset-password-form");
const resetMessage = document.getElementById("reset-message");
const forgotPanel = document.getElementById("forgot-panel");
const resetPanel = document.getElementById("reset-panel");
const resetPageTitle = document.getElementById("reset-page-title");
const resetPageSubtitle = document.getElementById("reset-page-subtitle");
const forgotSubmitButton = forgotForm?.querySelector('button[type="submit"]') || null;
let isForgotSubmitting = false;
let forgotSubmitLocked = false;

const resetContext = (() => {
    const params = new URLSearchParams(window.location.search);
    const email = (params.get("email") || "").trim();
    const token = (params.get("token") || "").trim();

    const hasValidEmail = email.length === 0 || /^\S+@\S+\.\S+$/.test(email);
    const hasValidToken = token.length >= 32;

    return {
        email,
        token,
        isResetLink: hasValidToken,
        hasValidEmail
    };
})();

function setMessage(text) {
    if (resetMessage) {
        resetMessage.textContent = text;
    }
}

function applyResetPageMode(isResetMode) {
    if (resetPageTitle) {
        resetPageTitle.textContent = isResetMode ? "Set New Password" : "Request Reset Link";
    }

    if (resetPageSubtitle) {
        resetPageSubtitle.textContent = isResetMode ? "Set New Password" : "Reset Password";
    }
}

async function fetchFromApi(path, options = {}, behavior = {}) {
    let lastNetworkError = null;
    let lastJsonResponse = null;

    for (const base of API_BASES) {
        try {
            const response = await fetch(`${base}${path}`, options);
            const contentType = (response.headers.get("content-type") || "").toLowerCase();
            const isJson = contentType.includes("application/json");

            if (isJson) {
                if (behavior.retryOnInvalidReset && response.status === 400) {
                    const data = await response
                        .clone()
                        .json()
                        .catch(() => null);

                    if (/invalid or expired reset link/i.test(String(data?.error || ""))) {
                        lastJsonResponse = response;
                        continue;
                    }
                }

                return response;
            }

            if (response.status >= 500) {
                return response;
            }
        } catch (error) {
            lastNetworkError = error;
        }
    }

    if (lastJsonResponse) {
        return lastJsonResponse;
    }

    throw new Error(lastNetworkError?.message || "Network error");
}

(function preloadFromQuery() {
    const forgotEmail = document.getElementById("forgot-email");
    const resetEmail = document.getElementById("reset-email");
    const resetToken = document.getElementById("reset-token");

    if (forgotPanel) {
        forgotPanel.hidden = resetContext.isResetLink;
    }

    if (resetPanel) {
        resetPanel.hidden = !resetContext.isResetLink;
    }

    applyResetPageMode(resetContext.isResetLink);

    if (resetContext.email && forgotEmail) {
        forgotEmail.value = resetContext.email;
    }

    if (resetContext.isResetLink && resetEmail && resetToken) {
        resetEmail.value = resetContext.email;
        resetToken.value = resetContext.token;
    }

    if (resetContext.email && !resetContext.hasValidEmail) {
        setMessage("Email in reset link looks invalid. You can still reset if the token is valid.");
    }

    if (!resetContext.token && resetContext.email) {
        setMessage("Your reset link appears invalid or incomplete. Please request a new one.");
    }
})();

forgotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (isForgotSubmitting || forgotSubmitLocked) {
        return;
    }

    const email = document.getElementById("forgot-email")?.value?.trim() || "";
    forgotSubmitLocked = true;
    isForgotSubmitting = true;

    if (forgotSubmitButton) {
        forgotSubmitButton.disabled = true;
        forgotSubmitButton.setAttribute("aria-busy", "true");
    }

    setMessage("Sending reset email...");

    try {
        const response = await fetchFromApi("/api/client/forgot-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Unable to send reset email");
        }

        const messageBase = data?.message || "If an account exists, a reset link has been sent.";
        setMessage(messageBase);
    } catch (error) {
        setMessage(error.message || "Unable to send reset email");
    } finally {
        isForgotSubmitting = false;
        if (forgotSubmitButton) {
            forgotSubmitButton.disabled = true;
            forgotSubmitButton.classList.add("locked-submit");
            forgotSubmitButton.textContent = "Reset Email Requested";
            forgotSubmitButton.removeAttribute("aria-busy");
        }
    }
});

resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!resetContext.isResetLink) {
        setMessage("Use the reset link from your email to set a new password.");
        return;
    }

    const email = document.getElementById("reset-email")?.value?.trim() || "";
    const token = document.getElementById("reset-token")?.value?.trim() || "";
    const password = document.getElementById("reset-password")?.value || "";
    const passwordConfirm = document.getElementById("reset-password-confirm")?.value || "";

    if (password !== passwordConfirm) {
        setMessage("Passwords do not match.");
        return;
    }

    if (password.length < 8) {
        setMessage("Password must be at least 8 characters.");
        return;
    }

    try {
        const response = await fetchFromApi("/api/client/reset-password", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, token, password })
        }, {
            retryOnInvalidReset: true
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Unable to reset password");
        }

        setMessage("Password reset successful. You can now sign in.");
        resetForm.reset();
        window.history.replaceState({}, "", "reset-password.html");

        if (resetPanel) {
            resetPanel.hidden = true;
        }

        if (forgotPanel) {
            forgotPanel.hidden = false;
        }

        applyResetPageMode(false);
    } catch (error) {
        const baseError = error.message || "Unable to reset password";
        if (/invalid or expired reset link/i.test(baseError)) {
            setMessage("Invalid or expired reset link. Request a new reset link and use the most recent email.");
            return;
        }

        setMessage(baseError);
    }
});
