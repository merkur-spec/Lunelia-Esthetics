const authSection = document.getElementById("client-auth-section");
const dashboard = document.getElementById("client-dashboard");
const authMessage = document.getElementById("client-auth-message");
const dashboardMessage = document.getElementById("client-dashboard-message");
const sessionSummary = document.getElementById("client-session-summary");
const loginForm = document.getElementById("client-login-form");
const appointmentsBody = document.querySelector("#client-appointments-table tbody");
const pastAppointmentsBody = document.querySelector("#client-past-appointments-table tbody");
const waxPassesBody = document.querySelector("#client-wax-passes-table tbody");
const pastAppointmentsToggleBtn = document.getElementById("toggle-client-past-appointments");
const logoutButton = document.getElementById("client-logout");
const reschedulePanel = document.getElementById("client-reschedule-panel");
const rescheduleDateInput = document.getElementById("client-reschedule-date");
const rescheduleSlotsBody = document.getElementById("client-reschedule-slots");
const rescheduleSaveButton = document.getElementById("client-reschedule-save");
const rescheduleCancelButton = document.getElementById("client-reschedule-cancel");
const rescheduleTarget = document.getElementById("client-reschedule-target");
const rescheduleMessage = document.getElementById("client-reschedule-message");

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#x27;");
}

function formatStatus(status) {
    const map = {
        confirmed: "Confirmed",
        late: "Late",
        cancelled: "Cancelled",
        no_show: "No-show",
        completed: "Completed"
    };
    const key = String(status || "").toLowerCase();
    return map[key] || (status ? escapeHtml(status.charAt(0).toUpperCase() + status.slice(1)) : "-");
}

const API_BASES = (() => {
    const bases = [];
    const isLocal = ["localhost", "127.0.0.1"].includes(window.location.hostname);

    if (isLocal) {
        bases.push("http://localhost:3001");
        bases.push("http://localhost:3000");
    }

    bases.push("");

    return Array.from(new Set(bases));
})();

let activeReschedule = null;
let pastAppointmentsExpanded = false;
const PAST_APPOINTMENTS_VISIBLE_ROWS = 3;
const WAX_PASS_SELECTION_KEY = "pendingWaxPassSelection";
const CLIENT_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

let clientIdleLogoutTimer = null;
let clientActivityTrackingBound = false;

function getWaxPassTierLabel(tier) {
    const map = {
        1: "Tier 1 (Buy 5, Get 1)",
        2: "Tier 2 (Buy 7, Get 2)",
        3: "Tier 3 (Buy 9, Get 3)"
    };
    return map[Number(tier)] || escapeHtml(`Tier ${tier}`);
}

function getWaxPassStatusLabel(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "active") return "Active";
    if (normalized === "completed") return "Completed";
    return status ? escapeHtml(status.charAt(0).toUpperCase() + status.slice(1)) : "-";
}

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

function stopClientIdleLogoutTimer() {
    if (clientIdleLogoutTimer) {
        window.clearTimeout(clientIdleLogoutTimer);
        clientIdleLogoutTimer = null;
    }
}

async function handleClientIdleTimeout() {
    if (!dashboard || dashboard.hidden) {
        return;
    }

    try {
        await fetchClientJson("/api/client/logout", {
            method: "POST"
        });
    } catch (error) {
    }

    closeReschedulePanel();
    pastAppointmentsExpanded = false;
    showDashboard(false);
    window.dispatchEvent(new CustomEvent("client-auth-state-changed", {
        detail: { signedIn: false }
    }));
    setMessage("Signed out due to inactivity.", false);
}

function resetClientIdleLogoutTimer() {
    if (!dashboard || dashboard.hidden) {
        return;
    }

    stopClientIdleLogoutTimer();
    clientIdleLogoutTimer = window.setTimeout(() => {
        handleClientIdleTimeout();
    }, CLIENT_IDLE_TIMEOUT_MS);
}

function bindClientActivityTracking() {
    if (clientActivityTrackingBound) {
        return;
    }

    clientActivityTrackingBound = true;
    const activityEvents = ["click", "keydown", "mousemove", "touchstart", "scroll"];

    activityEvents.forEach((eventName) => {
        window.addEventListener(
            eventName,
            () => {
                if (dashboard && !dashboard.hidden) {
                    resetClientIdleLogoutTimer();
                }
            },
            { passive: true }
        );
    });
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
    if (!show && sessionSummary) {
        sessionSummary.textContent = "";
    }

    if (show) {
        resetClientIdleLogoutTimer();
    } else {
        stopClientIdleLogoutTimer();
    }
}

function setClientSessionSummary(client) {
    if (!sessionSummary) {
        return;
    }

    const email = String(client?.email || "").trim();
    sessionSummary.textContent = email ? `Signed in as ${email}` : "";
}

function parseServices(servicesRaw) {
    try {
        const parsed = JSON.parse(servicesRaw || "[]");
        if (!Array.isArray(parsed)) {
            return "-";
        }

        const labels = parsed
            .map((service) => {
                if (typeof service === "string") {
                    return formatServiceId(service);
                }

                if (service && typeof service === "object") {
                    if (service.name) {
                        return String(service.name);
                    }
                    if (service.id) {
                        return formatServiceId(service.id);
                    }
                }

                return "";
            })
            .map((label) => String(label || "").trim())
            .filter(Boolean);

        return labels.join(", ") || "-";
    } catch (error) {
        return "-";
    }
}

function formatServiceId(serviceId) {
    const id = String(serviceId || "").trim();
    if (!id) {
        return "";
    }

    const catalogServices = window?.luneliaServiceCatalog?.getAllServices?.();
    if (Array.isArray(catalogServices)) {
        const exact = catalogServices.find((service) => String(service?.id || "") === id);
        if (exact?.name) {
            return String(exact.name);
        }
    }

    const specials = {
        brazilian: "Brazilian",
        dermaplaning: "Dermaplaning",
        underarms: "Underarms"
    };

    if (specials[id]) {
        return specials[id];
    }

    return id
        .split("-")
        .filter(Boolean)
        .map((word) => {
            if (word.length === 1) {
                return `(${word.toUpperCase()})`;
            }
            return word.charAt(0).toUpperCase() + word.slice(1);
        })
        .join(" ");
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

    if (pastAppointmentsToggleBtn) {
        pastAppointmentsToggleBtn.hidden = true;
    }

    if (!appointments || appointments.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="5">No appointments found for this account.</td>';
        appointmentsBody.appendChild(row);
    } else {
        appointments.forEach((appointment) => {
            const row = document.createElement("tr");
            row.innerHTML = `
                <td data-label="Date">${escapeHtml(appointment.date || "-")}</td>
                <td data-label="Time">${escapeHtml(appointment.time || "-")}</td>
                <td data-label="Services">${escapeHtml(parseServices(appointment.services) || "-")}</td>
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

                    if (result?.isWaxPass) {
                        if (result?.waxPassCreditForfeited) {
                            setMessage("Appointment cancelled. Wax pass credit forfeited due to late cancellation.", true);
                        } else if (result?.waxPassCreditRestored) {
                            setMessage("Appointment cancelled. Wax pass credit restored.", true);
                        } else {
                            setMessage("Appointment cancelled.", true);
                        }
                    } else {
                        setMessage(`Appointment cancelled.${feeText}`, true);
                    }
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
        await loadWaxPasses();
        return;
    }

    const visiblePastAppointments = pastAppointmentsExpanded
        ? pastAppointments
        : pastAppointments.slice(0, PAST_APPOINTMENTS_VISIBLE_ROWS);

    visiblePastAppointments.forEach((appointment) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td data-label="Date">${escapeHtml(appointment.date || "-")}</td>
            <td data-label="Time">${escapeHtml(appointment.time || "-")}</td>
            <td data-label="Services">${escapeHtml(parseServices(appointment.services) || "-")}</td>
            <td data-label="Status">${formatStatus(appointment.status)}</td>
        `;
        pastAppointmentsBody.appendChild(row);
    });

    if (pastAppointmentsToggleBtn) {
        pastAppointmentsToggleBtn.hidden = pastAppointments.length <= PAST_APPOINTMENTS_VISIBLE_ROWS;
        pastAppointmentsToggleBtn.textContent = pastAppointmentsExpanded
            ? "Show fewer past appointments"
            : "Show all past appointments";
    }

    await loadWaxPasses();
}

async function loadWaxPasses() {
    if (!waxPassesBody) {
        return;
    }

    const waxPasses = await fetchClientJson("/api/client/wax-passes");
    waxPassesBody.innerHTML = "";

    if (!Array.isArray(waxPasses) || waxPasses.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="5">No wax passes found.</td>';
        waxPassesBody.appendChild(row);
        return;
    }

    waxPasses.forEach((waxPass) => {
        const usedCredits = Number(waxPass.used_credits) || 0;
        const totalCredits = Number(waxPass.total_credits) || 0;
        const remainingCredits = Math.max(0, totalCredits - usedCredits);
        const isBookable = String(waxPass.status || "").toLowerCase() === "active" && remainingCredits > 0;

        const row = document.createElement("tr");
        row.innerHTML = `
            <td data-label="Service">${escapeHtml(waxPass.service_name || "-")}</td>
            <td data-label="Tier">${getWaxPassTierLabel(waxPass.tier)}</td>
            <td data-label="Credits">${usedCredits}/${totalCredits}</td>
            <td data-label="Status">${getWaxPassStatusLabel(waxPass.status)}</td>
            <td data-label="Action"></td>
        `;

        const actionCell = row.querySelector("td:last-child");
        const bookButton = document.createElement("button");
        bookButton.type = "button";
        bookButton.textContent = "Book";
        bookButton.disabled = !isBookable;
        if (!isBookable) {
            bookButton.classList.add("locked-submit");
        }

        bookButton.addEventListener("click", () => {
            const catalogServices = window?.luneliaServiceCatalog?.getAllServices?.();
            const catalogService = Array.isArray(catalogServices)
                ? catalogServices.find((service) => String(service?.id || "") === String(waxPass.service_id || ""))
                : null;
            const serviceDuration = Number(catalogService?.duration);

            const selection = {
                passId: Number(waxPass.id),
                serviceId: String(waxPass.service_id || ""),
                serviceName: String(waxPass.service_name || "Service"),
                servicePrice: Number(waxPass.per_use_price_cents || 0) / 100,
                serviceDuration: Number.isInteger(serviceDuration) && serviceDuration > 0 ? serviceDuration : 30
            };

            localStorage.setItem(WAX_PASS_SELECTION_KEY, JSON.stringify(selection));
            localStorage.setItem("cart", JSON.stringify([
                {
                    id: selection.serviceId,
                    name: selection.serviceName,
                    price: selection.servicePrice,
                    duration: selection.serviceDuration
                }
            ]));
            localStorage.setItem("total", String(Math.round(selection.servicePrice)));

            window.location.href = "booking.html";
        });

        actionCell.appendChild(bookButton);
        waxPassesBody.appendChild(row);
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
        setClientSessionSummary(data?.client || { email });
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
    pastAppointmentsExpanded = false;
    showDashboard(false);
    window.dispatchEvent(new CustomEvent("client-auth-state-changed", {
        detail: { signedIn: false }
    }));
    setMessage("Signed out.", false);
});

pastAppointmentsToggleBtn?.addEventListener("click", async () => {
    pastAppointmentsExpanded = !pastAppointmentsExpanded;

    try {
        await loadAppointments();
    } catch (error) {
        setMessage(error.message, true);
    }
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
    bindClientActivityTracking();

    try {
        const session = await fetchClientJson("/api/client/session");
        showDashboard(true);
        setClientSessionSummary(session?.client || null);
        await loadAppointments();
        return;
    } catch (error) {
        closeReschedulePanel();
    }

    showDashboard(false);
})();
