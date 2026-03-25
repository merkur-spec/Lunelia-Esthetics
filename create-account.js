const form = document.getElementById("create-account-form");
const message = document.getElementById("create-account-message");
const API_BASE = window.location.port === "3001" ? "http://localhost:3001" : "";

function setMessage(text) {
    if (message) {
        message.textContent = text;
    }
}

form?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = document.getElementById("create-name")?.value?.trim() || "";
    const email = document.getElementById("create-email")?.value?.trim() || "";
    const password = document.getElementById("create-password")?.value || "";
    const passwordConfirm = document.getElementById("create-password-confirm")?.value || "";

    if (password !== passwordConfirm) {
        setMessage("Passwords do not match.");
        return;
    }

    if (password.length < 8) {
        setMessage("Password must be at least 8 characters.");
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/api/client/register`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name, email, password })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Account creation failed");
        }

        window.location.href = "client.html";
    } catch (error) {
        setMessage(error.message || "Unable to create account");
    }
});
