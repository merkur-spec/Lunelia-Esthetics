const loginForm = document.getElementById("admin-login");
const adminUserInput = document.getElementById("admin-user");
const adminPassInput = document.getElementById("admin-pass");
const adminMessage = document.getElementById("admin-message");
const appointmentsTableBody = document.querySelector("#appointments-table tbody");

let authHeader = "";

function setAdminMessage(message) {
    if (adminMessage) {
        adminMessage.textContent = message;
    }
}

function buildAuthHeader() {
    const user = adminUserInput.value.trim();
    const pass = adminPassInput.value.trim();

    if (!user || !pass) {
        return "";
    }

    return `Basic ${btoa(`${user}:${pass}`)}`;
}

function renderAppointments(appointments) {
    appointmentsTableBody.innerHTML = "";

    if (!appointments || appointments.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 8;
        cell.textContent = "No appointments found.";
        row.appendChild(cell);
        appointmentsTableBody.appendChild(row);
        return;
    }

    appointments.forEach((appointment) => {
        const row = document.createElement("tr");
        const services = (() => {
            try {
                return JSON.parse(appointment.services || "[]")
                    .map((service) => service.name)
                    .join(", ");
            } catch (err) {
                return "";
            }
        })();

        row.innerHTML = `
            <td>${appointment.date || "-"}</td>
            <td>${appointment.time || "-"}</td>
            <td>${appointment.name || "-"}</td>
            <td>${appointment.email || "-"}</td>
            <td>${appointment.phone || "-"}</td>
            <td>${services || "-"}</td>
            <td>${appointment.status || "-"}</td>
            <td></td>
        `;

        const actionCell = row.querySelector("td:last-child");
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Cancel";
        cancelButton.disabled = appointment.status !== "confirmed";

        cancelButton.addEventListener("click", async () => {
            try {
                const response = await fetch(`/api/admin/appointments/${appointment.id}/cancel`, {
                    method: "POST",
                    headers: { Authorization: authHeader }
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || "Failed to cancel appointment");
                }

                setAdminMessage("Appointment cancelled.");
                await loadAppointments();
            } catch (error) {
                setAdminMessage(error.message);
            }
        });

        actionCell.appendChild(cancelButton);
        appointmentsTableBody.appendChild(row);
    });
}

async function loadAppointments() {
    try {
        const response = await fetch("/api/admin/appointments", {
            headers: { Authorization: authHeader }
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.error || "Unable to load appointments");
        }

        const appointments = await response.json();
        renderAppointments(appointments);
    } catch (error) {
        setAdminMessage(error.message);
        renderAppointments([]);
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authHeader = buildAuthHeader();

    if (!authHeader) {
        setAdminMessage("Please enter your admin credentials.");
        return;
    }

    setAdminMessage("Loading appointments...");
    await loadAppointments();
});
