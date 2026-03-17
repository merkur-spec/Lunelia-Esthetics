(function updateMenuForClientSession() {
    const token = localStorage.getItem("clientToken");
    if (!token) {
        return;
    }

    document.querySelectorAll('a[href="client.html"]').forEach((link) => {
        link.textContent = "Your Appointments";
    });
})();
