const API_BASE = window.location.port === "5500" ? "http://localhost:3000" : "";
const forgotForm = document.getElementById("forgot-password-form");
const resetForm = document.getElementById("reset-password-form");
const resetMessage = document.getElementById("reset-message");

function setMessage(text) {
    if (resetMessage) {
        resetMessage.textContent = text;
    }
}

(function preloadFromQuery() {
    const params = new URLSearchParams(window.location.search);
    const email = params.get("email") || "";
    const token = params.get("token") || "";

    const forgotEmail = document.getElementById("forgot-email");
    const resetEmail = document.getElementById("reset-email");
    const resetToken = document.getElementById("reset-token");

    if (email && forgotEmail) {
        forgotEmail.value = email;
    }

    if (email && resetEmail) {
        resetEmail.value = email;
    }

    if (token && resetToken) {
        resetToken.value = token;
    }
})();

forgotForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("forgot-email")?.value?.trim() || "";

    try {
        const response = await fetch(`${API_BASE}/api/client/forgot-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Unable to send reset email");
        }

        setMessage(data?.message || "If an account exists, a reset link has been sent.");
    } catch (error) {
        setMessage(error.message || "Unable to send reset email");
    }
});

resetForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

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
        const response = await fetch(`${API_BASE}/api/client/reset-password`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, token, password })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Unable to reset password");
        }

        setMessage("Password reset successful. You can now sign in.");
        resetForm.reset();
    } catch (error) {
        setMessage(error.message || "Unable to reset password");
    }
});
