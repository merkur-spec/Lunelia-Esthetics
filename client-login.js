const authMessage = document.getElementById("client-auth-message");
const loginForm = document.getElementById("client-login-form");
const emailInput = document.getElementById("client-login-email");
const passwordInput = document.getElementById("client-login-password");
const resendVerificationButton = document.getElementById("client-resend-verification-btn");

function setMessage(message) {
    if (authMessage) {
        authMessage.textContent = message;
    }
}

loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = String(emailInput?.value || "").trim();
    const password = String(passwordInput?.value || "");

    if (!email || !password) {
        setMessage("Please enter your email and password.");
        return;
    }

    try {
        setMessage("Signing in...");

        const response = await fetch("/api/client/login", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Unable to sign in");
        }

        window.location.href = "client.html";
    } catch (error) {
        setMessage(error.message || "Unable to sign in");
    }
});

resendVerificationButton?.addEventListener("click", async () => {
    const email = String(emailInput?.value || "").trim();

    if (!email) {
        setMessage("Enter your email, then press Resend Verification Email.");
        return;
    }

    try {
        setMessage("Sending verification email...");

        const response = await fetch("/api/client/resend-verification", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Unable to send verification email");
        }

        setMessage(data?.message || "Verification email sent. Please check your inbox.");
    } catch (error) {
        setMessage(error.message || "Unable to send verification email");
    }
});
