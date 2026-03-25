(function updateMenuForClientSession() {
    const apiBase = window.location.port === "3001" ? "http://localhost:3001" : "";

    fetch(`${apiBase}/api/client/session`, {
        method: "GET",
        credentials: "include"
    })
        .then((response) => {
            if (!response.ok) {
                return null;
            }

            return response.json().catch(() => null);
        })
        .then((data) => {
            if (!data?.success) {
                return;
            }

            document.querySelectorAll('a[href="client.html"]').forEach((link) => {
                link.textContent = "Your Appointments";
            });
        })
        .catch(() => {
            // no-op
        });
})();
