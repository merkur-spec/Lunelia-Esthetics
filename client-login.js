const authMessage = document.getElementById("client-auth-message");
const loginForm = document.getElementById("client-login-form");
const emailInput = document.getElementById("client-login-email");
const passwordInput = document.getElementById("client-login-password");
let resendInFlight = false;

function setMessage(message) {
    if (authMessage) {
        authMessage.textContent = message;
    }
}

function renderVerificationPrompt() {
    if (!authMessage) {
        return;
    }

    authMessage.innerHTML =
        'This user account still needs to be verified. <a href="#" id="client-resend-verification-link">Resend Verification Link to Email</a>';

    const resendLink = document.getElementById("client-resend-verification-link");
    resendLink?.addEventListener("click", async (event) => {
        event.preventDefault();
        await resendVerificationEmail();
    });
}

async function resendVerificationEmail() {
    if (resendInFlight) {
        return;
    }

    const email = String(emailInput?.value || "").trim();

    if (!email) {
        setMessage("Enter your email, then try resending the verification link.");
        return;
    }

    try {
        resendInFlight = true;
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

        resendInFlight = false;
        setMessage(data?.message || "Verification email sent. Please check your inbox.");
    } catch (error) {
        resendInFlight = false;
        const message = error.message || "Unable to send verification email";

        if (authMessage) {
            authMessage.textContent = `${message} `;
            const retryLink = document.createElement("a");
            retryLink.href = "#";
            retryLink.id = "client-resend-verification-link";
            retryLink.textContent = "Resend Verification Link to Email";
            retryLink.addEventListener("click", async (event) => {
                event.preventDefault();
                await resendVerificationEmail();
            });
            authMessage.appendChild(retryLink);
        }
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
            if (data?.requiresVerification) {
                renderVerificationPrompt();
                return;
            }

            throw new Error(data?.error || "Unable to sign in");
        }

        window.location.href = "client.html";
    } catch (error) {
        setMessage(error.message || "Unable to sign in");
    }
});
