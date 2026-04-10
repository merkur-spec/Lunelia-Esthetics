const authSection = document.getElementById("client-auth-section");
const dashboard = document.getElementById("client-dashboard");
const authMessage = document.getElementById("client-auth-message");
const dashboardMessage = document.getElementById("client-dashboard-message");
const loginForm = document.getElementById("client-login-form");
const appointmentsBody = document.querySelector("#client-appointments-table tbody");
const pastAppointmentsBody = document.querySelector("#client-past-appointments-table tbody");
const logoutButton = document.getElementById("client-logout");
const reschedulePanel = document.getElementById("client-reschedule-panel");
const rescheduleDateInput = document.getElementById("client-reschedule-date");
const rescheduleSlotsBody = document.getElementById("client-reschedule-slots");
const rescheduleSaveButton = document.getElementById("client-reschedule-save");
const rescheduleCancelButton = document.getElementById("client-reschedule-cancel");
const rescheduleTarget = document.getElementById("client-reschedule-target");
const rescheduleMessage = document.getElementById("client-reschedule-message");

function formatStatus(status) {
    const map = {
        confirmed: "Confirmed",
        late: "Late",
        cancelled: "Cancelled",
        no_show: "No-show",
        completed: "Completed"
    };
    const key = String(status || "").toLowerCase();
    return map[key] || (status ? status.charAt(0).toUpperCase() + status.slice(1) : "-");
}

const API_BASES = (() => {
    const bases = [""];
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

    if (isLocal) {
        if (window.location.port !== "3001") {
            bases.push("http://localhost:3001");
        }
        if (window.location.port !== "3000") {
            bases.push("http://localhost:3000");
        }
    }

    return Array.from(new Set(bases));
})();

let activeReschedule = null;

function getCookie(name) {
    const cookies = document.cookie ? document.cookie.split(";") : [];

    for (const cookie of cookies) {
        const [rawKey, ...rawValueParts] = cookie.split("=");
        const key = decodeURIComponent(String(rawKey || "").trim());
        if (key !== name) {
            continue;
        }

        return decodeURIComponent(rawValueParts.join("=").trim());
    }

    return "";
}

function getCsrfToken() {
    return getCookie("clientCsrf");
}

function setMessage(message, inDashboard = false) {
    const target = inDashboard ? dashboardMessage : authMessage;
    if (target) {
        target.textContent = message;
    }
}

function showDashboard(show) {
    if (authSection) {
        authSection.hidden = show;
    }
    if (dashboard) {
        dashboard.hidden = !show;
    }
    if (!show && dashboardMessage) {
        dashboardMessage.textContent = "";
    }
}

function parseServices(servicesRaw) {
    try {
        const parsed = JSON.parse(servicesRaw || "[]");
        return Array.isArray(parsed) ? parsed.map((service) => service.name).join(", ") : "-";
    } catch (error) {
        return "-";
    }
}

function toMinutes(timeText) {
    const [hours, minutes] = String(timeText || "").split(":").map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) {
        return null;
    }
    return hours * 60 + minutes;
}

function rangesOverlap(startA, durationA, startB, durationB) {
    return startA < startB + durationB && startB < startA + durationA;
}

function buildTimeSlots(startHour = 9, endHour = 18, intervalMinutes = 15, endMinute = 0) {
    const slots = [];
    let currentMinutes = startHour * 60;
    const endMinutes = endHour * 60 + endMinute;

    while (currentMinutes < endMinutes) {
        const hour = Math.floor(currentMinutes / 60);
        const minute = currentMinutes % 60;
        const hh = String(hour).padStart(2, "0");
        const mm = String(minute).padStart(2, "0");
        slots.push(`${hh}:${mm}`);
        currentMinutes += intervalMinutes;
    }

    return slots;
}

const rescheduleTimes = buildTimeSlots(9, 17, 15, 30);

async function fetchFromApi(path, options = {}) {
    let lastNetworkError = null;

    for (const base of API_BASES) {
        try {
            const response = await fetch(`${base}${path}`, {
                ...options,
                credentials: "include"
            });
            return response;
        } catch (error) {
            lastNetworkError = error;
        }
    }

    throw new Error(lastNetworkError?.message || "NetworkError when attempting to fetch resource.");
}

function closeReschedulePanel() {
    activeReschedule = null;
    if (reschedulePanel) {
        reschedulePanel.hidden = true;
    }
    if (rescheduleDateInput) {
        rescheduleDateInput.value = "";
    }
    if (rescheduleSlotsBody) {
        rescheduleSlotsBody.innerHTML = "";
    }
    if (rescheduleSaveButton) {
        rescheduleSaveButton.disabled = true;
    }
    if (rescheduleMessage) {
        rescheduleMessage.textContent = "";
    }
}

function selectRescheduleTime(button, time) {
    if (!activeReschedule) {
        return;
    }

    activeReschedule.selectedTime = time;

    const selectedStart = toMinutes(time);
    const selectedDuration = Number(activeReschedule.durationMinutes) || 30;

    rescheduleSlotsBody.querySelectorAll("button").forEach((slotButton) => {
        slotButton.classList.remove("selected", "selected-range");
        slotButton.setAttribute("aria-pressed", "false");

        const buttonMinutes = toMinutes(slotButton.textContent.trim());
        if (selectedStart === null || buttonMinutes === null) {
            return;
        }

        const inSelectedBlock =
            buttonMinutes >= selectedStart && buttonMinutes < selectedStart + selectedDuration;

        if (!inSelectedBlock) {
            return;
        }

        if (buttonMinutes === selectedStart) {
            slotButton.classList.add("selected");
            slotButton.setAttribute("aria-pressed", "true");
        } else {
            slotButton.classList.add("selected-range");
        }
    });

    if (rescheduleSaveButton) {
        rescheduleSaveButton.disabled = false;
    }
}

async function renderRescheduleSlots(date) {
    if (!activeReschedule || !rescheduleSlotsBody) {
        return;
    }

    activeReschedule.selectedDate = date;
    activeReschedule.selectedTime = "";

    if (rescheduleSaveButton) {
        rescheduleSaveButton.disabled = true;
    }

    rescheduleSlotsBody.innerHTML = "";
    const requestedDuration = Number(activeReschedule.durationMinutes) || 30;
    const closeOfDay = toMinutes("17:30");

    try {
        const appointments = await fetchFromApi(`/api/appointments?date=${encodeURIComponent(date)}`)
            .then(async (response) => {
                const data = await response.json().catch(() => null);
                if (!response.ok) {
                    throw new Error(data?.error || "Unable to load appointments");
                }
                return Array.isArray(data) ? data : [];
            });

        const columnsPerRow = 4;
        let row = null;
        let skippedCurrent = false;

        rescheduleTimes.forEach((time, index) => {
            if (index % columnsPerRow === 0) {
                row = document.createElement("tr");
                rescheduleSlotsBody.appendChild(row);
            }

            const button = document.createElement("button");
            button.type = "button";
            button.textContent = time;
            button.setAttribute("aria-pressed", "false");

            const slotStart = toMinutes(time);
            const exceedsBusinessHours =
                slotStart === null || closeOfDay === null
                    ? true
                    : slotStart + requestedDuration > closeOfDay;

            const conflict = appointments.some((appointment) => {
                const appointmentTime = String(appointment?.time || "").slice(0, 5);
                const appointmentDuration = Number(appointment?.duration_minutes) || 30;

                if (
                    !skippedCurrent &&
                    date === activeReschedule.currentDate &&
                    appointmentTime === activeReschedule.currentTime &&
                    appointmentDuration === requestedDuration
                ) {
                    skippedCurrent = true;
                    return false;
                }

                const bookedStart = toMinutes(appointmentTime);

                if (slotStart === null || bookedStart === null) {
                    return false;
                }

                return rangesOverlap(slotStart, requestedDuration, bookedStart, appointmentDuration);
            });

            if (exceedsBusinessHours || conflict) {
                button.disabled = true;
                button.classList.add("disabled");
                button.setAttribute("aria-disabled", "true");
            }

            button.addEventListener("click", () => selectRescheduleTime(button, time));

            const cell = document.createElement("td");
            cell.appendChild(button);
            row.appendChild(cell);
        });

        const remainder = rescheduleTimes.length % columnsPerRow;
        if (remainder !== 0 && row) {
            for (let column = remainder; column < columnsPerRow; column += 1) {
                const spacerCell = document.createElement("td");
                spacerCell.className = "time-slot-placeholder";
                spacerCell.setAttribute("aria-hidden", "true");

                const spacer = document.createElement("span");
                spacer.className = "time-slot-spacer";
                spacer.textContent = "-";

                spacerCell.appendChild(spacer);
                row.appendChild(spacerCell);
            }
        }

        if (rescheduleMessage) {
            rescheduleMessage.textContent = "Select a new time, then confirm reschedule.";
        }
    } catch (error) {
        if (rescheduleMessage) {
            rescheduleMessage.textContent = error.message;
        }
    }
}

function openReschedulePanel(appointment) {
    if (!reschedulePanel || !rescheduleDateInput) {
        return;
    }

    activeReschedule = {
        appointmentId: appointment.id,
        durationMinutes: Number(appointment.duration_minutes) || 30,
        currentDate: appointment.date || "",
        currentTime: String(appointment.time || "").slice(0, 5),
        selectedDate: "",
        selectedTime: ""
    };

    reschedulePanel.hidden = false;
    if (rescheduleTarget) {
        rescheduleTarget.textContent = `Current appointment: ${activeReschedule.currentDate} at ${activeReschedule.currentTime}`;
    }

    const today = new Date().toISOString().split("T")[0];
    rescheduleDateInput.min = today;
    rescheduleDateInput.value = activeReschedule.currentDate || today;

    renderRescheduleSlots(rescheduleDateInput.value);
    reschedulePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function fetchClientJson(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const headers = {
        ...(options.headers || {})
    };

    if (!["GET", "HEAD", "OPTIONS"].includes(method)) {
        const csrfToken = getCsrfToken();
        if (csrfToken) {
            headers["X-CSRF-Token"] = csrfToken;
        }
    }

    const response = await fetchFromApi(url, {
        ...options,
        headers
    });

    const data = await response.json().catch(() => null);
    if (!response.ok) {
        throw new Error(data?.error || "Request failed");
    }

    return data;
}

async function loadAppointments() {
    const [appointments, pastAppointments] = await Promise.all([
        fetchClientJson("/api/client/appointments"),
        fetchClientJson("/api/client/appointments/past")
    ]);

    appointmentsBody.innerHTML = "";
    if (pastAppointmentsBody) {
        pastAppointmentsBody.innerHTML = "";
    }

    if (!appointments || appointments.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="5">No appointments found for this account.</td>';
        appointmentsBody.appendChild(row);
    } else {
        appointments.forEach((appointment) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td data-label="Date">${appointment.date || "-"}</td>
                <td data-label="Time">${appointment.time || "-"}</td>
                <td data-label="Services">${parseServices(appointment.services) || "-"}</td>
                <td data-label="Status">${formatStatus(appointment.status)}</td>
                <td data-label="Action"></td>
            `;

            const actionCell = row.querySelector("td:last-child");

            const isActiveAppointment = ["confirmed", "late"].includes(
                String(appointment.status || "").toLowerCase()
            );

            const rescheduleBtn = document.createElement("button");
            rescheduleBtn.type = "button";
            rescheduleBtn.textContent = "Reschedule";
            rescheduleBtn.disabled = !isActiveAppointment;

            rescheduleBtn.addEventListener("click", () => {
                openReschedulePanel(appointment);
            });

            const cancelBtn = document.createElement("button");
            cancelBtn.type = "button";
            cancelBtn.textContent = "Cancel";
            cancelBtn.disabled = !isActiveAppointment;

            cancelBtn.addEventListener("click", async () => {
                const shouldCancel = window.confirm(
                    "Are you sure you want to cancel this appointment?"
                );

                if (!shouldCancel) {
                    return;
                }

                cancelBtn.disabled = true;
                rescheduleBtn.disabled = true;
                setMessage("Cancelling appointment...", true);

                try {
                    const result = await fetchClientJson(`/api/client/appointments/${appointment.id}/cancel`, {
                        method: "POST"
                    });

                    const feeText = Number(result.feePercent) > 0
                        ? ` A ${result.feePercent}% fee applies based on cancellation policy.`
                        : "";

                    setMessage(`Appointment cancelled.${feeText}`, true);
                    await loadAppointments();
                } catch (error) {
                    setMessage(error.message, true);
                    cancelBtn.disabled = !isActiveAppointment;
                    rescheduleBtn.disabled = !isActiveAppointment;
                }
            });

            actionCell.appendChild(rescheduleBtn);
            actionCell.appendChild(cancelBtn);
            appointmentsBody.appendChild(row);
        });
    }

    if (!pastAppointmentsBody) {
        return;
    }

    if (!pastAppointments || pastAppointments.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="4">No past appointments found.</td>';
        pastAppointmentsBody.appendChild(row);
        return;
    }

    pastAppointments.forEach((appointment) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td data-label="Date">${appointment.date || "-"}</td>
            <td data-label="Time">${appointment.time || "-"}</td>
            <td data-label="Services">${parseServices(appointment.services) || "-"}</td>
            <td data-label="Status">${formatStatus(appointment.status)}</td>
        `;
        pastAppointmentsBody.appendChild(row);
    });
}

loginForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const email = document.getElementById("client-login-email")?.value?.trim();
    const password = document.getElementById("client-login-password")?.value || "";

    try {
        const response = await fetchFromApi("/api/client/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });

        const data = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(data?.error || "Sign in failed");
        }

        showDashboard(true);
        window.dispatchEvent(new CustomEvent("client-auth-state-changed", {
            detail: { signedIn: true }
        }));
        setMessage("Signed in.", true);
        await loadAppointments();
    } catch (error) {
        setMessage(error.message, false);
    }
});

logoutButton?.addEventListener("click", async () => {
    try {
        await fetchClientJson("/api/client/logout", {
            method: "POST"
        });
    } catch (error) {
        setMessage(error.message, true);
        return;
    }

    closeReschedulePanel();
    showDashboard(false);
    window.dispatchEvent(new CustomEvent("client-auth-state-changed", {
        detail: { signedIn: false }
    }));
    setMessage("Signed out.", false);
});

rescheduleDateInput?.addEventListener("change", () => {
    if (!rescheduleDateInput.value || !activeReschedule) {
        return;
    }
    renderRescheduleSlots(rescheduleDateInput.value);
});

rescheduleCancelButton?.addEventListener("click", () => {
    closeReschedulePanel();
});

rescheduleSaveButton?.addEventListener("click", async () => {
    if (!activeReschedule?.appointmentId || !activeReschedule.selectedDate || !activeReschedule.selectedTime) {
        if (rescheduleMessage) {
            rescheduleMessage.textContent = "Select a date and time to continue.";
        }
        return;
    }

    rescheduleSaveButton.disabled = true;

    try {
        await fetchClientJson(`/api/client/appointments/${activeReschedule.appointmentId}/reschedule`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                date: activeReschedule.selectedDate,
                time: activeReschedule.selectedTime
            })
        });

        setMessage("Appointment rescheduled.", true);
        closeReschedulePanel();
        await loadAppointments();
    } catch (error) {
        if (rescheduleMessage) {
            rescheduleMessage.textContent = error.message;
        }
        rescheduleSaveButton.disabled = false;
    }
});

(async function init() {
    try {
        await fetchClientJson("/api/client/session");
        showDashboard(true);
        await loadAppointments();
        return;
    } catch (error) {
        closeReschedulePanel();
    }

    showDashboard(false);
})();
