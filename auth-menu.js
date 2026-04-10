(function updateMenuForClientSession() {
    const apiBase = window.location.port === "3001" ? "http://localhost:3001" : "";

    function setClientMenuLabel(isSignedIn) {
        document.querySelectorAll('a[href="client.html"]').forEach((link) => {
            link.textContent = isSignedIn ? "Your Appointments" : "Sign In";
        });
    }

    window.addEventListener("client-auth-state-changed", (event) => {
        setClientMenuLabel(event?.detail?.signedIn === true);
    });

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
            setClientMenuLabel(data?.success === true);
        })
        .catch(() => {
            setClientMenuLabel(false);
        });
})();
