const titleEl = document.getElementById("verify-title");
const messageEl = document.getElementById("verify-message");

function setStatus(title, message) {
    if (titleEl) {
        titleEl.textContent = title;
    }
    if (messageEl) {
        messageEl.textContent = message;
    }
}

(async function init() {
    const params = new URLSearchParams(window.location.search);
    const token = String(params.get("token") || "").trim();
    const email = String(params.get("email") || "").trim();
    const apiBase = String(params.get("api") || window.location.origin).trim().replace(/\/+$/, "");

    if (!token) {
        setStatus("Unable to verify email", "This verification link is missing a token.");
        return;
    }

    try {
        const response = await fetch(`${apiBase}/api/client/verify-email`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token, email })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Unable to verify email");
        }

        setStatus("Email verified", data?.message || "You can now sign in.");
    } catch (error) {
        setStatus("Unable to verify email", error.message || "Please request a new verification link.");
    }
})();
