const loginForm = document.getElementById("admin-login");
const adminUserInput = document.getElementById("admin-user");
const adminPassInput = document.getElementById("admin-pass");
const adminLogoutButton = document.getElementById("admin-logout");
const loginSection = document.getElementById("admin-login-section");
const dashboardSection = document.getElementById("admin-dashboard");
const adminMessage = document.getElementById("admin-message");
const dashboardMessage = document.getElementById("dashboard-message");
const appointmentsTableBody = document.querySelector("#appointments-table tbody");
const pastAppointmentsTableBody = document.querySelector("#past-appointments-table tbody");
const reportsSection = document.getElementById("admin-reports");
const financeSection = document.getElementById("admin-finance");
const analyticsFilterForm = document.getElementById("analytics-filter");
const analyticsStartInput = document.getElementById("analytics-start");
const analyticsEndInput = document.getElementById("analytics-end");
const dailyAnalyticsBody = document.querySelector("#analytics-daily-table tbody");
const dailyToggleBtn = document.getElementById("toggle-daily-performance");
const topServicesBody = document.querySelector("#analytics-services-table tbody");
const expensesTableBody = document.querySelector("#expenses-table tbody");
const expenseForm = document.getElementById("expense-form");
const expenseDateInput = document.getElementById("expense-date");
const expenseCategoryInput = document.getElementById("expense-category");
const expenseAmountInput = document.getElementById("expense-amount");
const expenseDescriptionInput = document.getElementById("expense-description");
const adminReschedulePanel = document.getElementById("admin-reschedule-panel");
const adminRescheduleDateInput = document.getElementById("admin-reschedule-date");
const adminRescheduleSlotsBody = document.getElementById("admin-reschedule-slots");
const adminRescheduleSaveButton = document.getElementById("admin-reschedule-save");
const adminRescheduleCancelButton = document.getElementById("admin-reschedule-cancel");
const adminRescheduleTarget = document.getElementById("admin-reschedule-target");
const adminRescheduleMessage = document.getElementById("admin-reschedule-message");

const metricAppointments = document.getElementById("metric-appointments");
const metricConfirmed = document.getElementById("metric-confirmed");
const metricCancelled = document.getElementById("metric-cancelled");
const metricRevenue = document.getElementById("metric-revenue");
const metricAvgTicket = document.getElementById("metric-avg-ticket");
const metricCompletionRate = document.getElementById("metric-completion-rate");
const metricConfirmedRevenue = document.getElementById("metric-confirmed-revenue");
const metricCancelFees = document.getElementById("metric-cancel-fees");
const metricNoShowFees = document.getElementById("metric-no-show-fees");
const metricExpenses = document.getElementById("metric-expenses");
const metricNetRevenue = document.getElementById("metric-net-revenue");

let isAdminAuthenticated = false;
let dailyExpanded = false;
const DAILY_VISIBLE_ROWS = 1;
let activeAdminReschedule = null;
let expenseUndoToast = null;
let expenseUndoTimer = null;

function ensureLocalAdminNodeOrigin() {
    const isHttp = window.location.protocol === "http:" || window.location.protocol === "https:";
    const pathname = String(window.location.pathname || "");
    const isAdminAlias = /(^|\/)admin(?:\.html)?\/?$/i.test(pathname);
    const isNodePort = window.location.port === "3001";

    if (!isHttp || !isAdminAlias) {
        return;
    }

    const isCanonicalPath = /(^|\/)admin\.html$/i.test(pathname);
    if (isNodePort && isCanonicalPath) {
        return;
    }

    const targetHost = window.location.hostname;
    const targetUrl = `http://${targetHost}:3001/admin.html${window.location.search}${window.location.hash}`;
    window.location.replace(targetUrl);
}

ensureLocalAdminNodeOrigin();

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

function buildTimeSlots(startHour = 9, endHour = 18, intervalMinutes = 15) {
    const slots = [];

    for (let hour = startHour; hour < endHour; hour += 1) {
        for (let minute = 0; minute < 60; minute += intervalMinutes) {
            const hh = String(hour).padStart(2, "0");
            const mm = String(minute).padStart(2, "0");
            slots.push(`${hh}:${mm}`);
        }
    }

    return slots;
}

const adminRescheduleTimes = buildTimeSlots(9, 18, 15);

function setAdminMessage(message) {
    const isLoggedIn = loginSection?.hidden;
    const target = isLoggedIn ? dashboardMessage : adminMessage;

    if (target) {
        target.textContent = message;
    }
}

function dismissExpenseUndoToast() {
    if (expenseUndoTimer) {
        clearTimeout(expenseUndoTimer);
        expenseUndoTimer = null;
    }

    if (expenseUndoToast) {
        expenseUndoToast.remove();
        expenseUndoToast = null;
    }
}

function showExpenseUndoToast(expense) {
    if (!expense) {
        return;
    }

    dismissExpenseUndoToast();

    const toast = document.createElement("div");
    toast.className = "admin-undo-toast";

    const message = document.createElement("span");
    message.textContent = "Expense removed.";

    const undoButton = document.createElement("button");
    undoButton.type = "button";
    undoButton.className = "cart-remove-btn";
    undoButton.textContent = "Undo";

    undoButton.addEventListener("click", async () => {
        undoButton.disabled = true;

        try {
            await fetchAdminJson("/api/admin/expenses", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: expense.date,
                    category: expense.category,
                    amount: (Number(expense.amount_cents) || 0) / 100,
                    description: expense.description || ""
                })
            });

            dismissExpenseUndoToast();
            setAdminMessage("Expense restored.");
            await loadFinance();
        } catch (error) {
            undoButton.disabled = false;
            setAdminMessage(error.message || "Unable to restore expense");
        }
    });

    toast.appendChild(message);
    toast.appendChild(undoButton);
    document.body.appendChild(toast);

    expenseUndoToast = toast;
    expenseUndoTimer = setTimeout(() => {
        dismissExpenseUndoToast();
    }, 8000);
}

function setAuthenticatedLayout(isAuthenticated) {
    isAdminAuthenticated = isAuthenticated;

    if (loginSection) {
        loginSection.hidden = isAuthenticated;
    }

    if (dashboardSection) {
        dashboardSection.hidden = !isAuthenticated;
    }

    if (isAuthenticated && adminMessage) {
        adminMessage.textContent = "";
    }

    if (!isAuthenticated && dashboardMessage) {
        dashboardMessage.textContent = "";
    }
}

function readCookie(name) {
    const cookieString = document.cookie || "";
    const parts = cookieString.split(";");

    for (const part of parts) {
        const trimmed = part.trim();
        if (!trimmed) {
            continue;
        }

        const separatorIndex = trimmed.indexOf("=");
        if (separatorIndex <= 0) {
            continue;
        }

        const key = decodeURIComponent(trimmed.slice(0, separatorIndex));
        if (key !== name) {
            continue;
        }

        return decodeURIComponent(trimmed.slice(separatorIndex + 1));
    }

    return "";
}

function getAdminCsrfToken() {
    return readCookie("adminCsrf");
}

function formatCurrency(cents) {
    const dollars = (Number(cents) || 0) / 100;
    return dollars.toLocaleString(undefined, {
        style: "currency",
        currency: "USD"
    });
}

function formatPercent(value) {
    const parsed = Number(value) || 0;
    return `${parsed.toFixed(1)}%`;
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function toIsoDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function setDefaultDateRange() {
    if (!analyticsStartInput || !analyticsEndInput) {
        return;
    }

    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 29);

    analyticsEndInput.value = toIsoDate(end);
    analyticsStartInput.value = toIsoDate(start);
}

async function parseApiResponse(response) {
    const contentType = (response.headers.get("content-type") || "").toLowerCase();

    if (contentType.includes("application/json")) {
        try {
            return await response.json();
        } catch (error) {
            return null;
        }
    }

    const text = await response.text();
    return { rawText: text };
}

async function fetchAdminJson(url, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
    const csrfToken = isMutation ? getAdminCsrfToken() : "";
    const response = await fetch(url, {
        ...options,
        credentials: "same-origin",
        headers: {
            ...(options.headers || {}),
            ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {})
        }
    });

    const data = await parseApiResponse(response);

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            setAuthenticatedLayout(false);
        }

        const fallbackMessage =
            response.status === 401 || response.status === 403
                ? "Please sign in again."
                : "Request failed";

        throw new Error(
            data?.error ||
                data?.message ||
                (typeof data?.rawText === "string" && data.rawText.trim().startsWith("<")
                    ? `API returned HTML instead of JSON. Current page: ${window.location.href}. Open admin from the Node server URL (http://localhost:3001/admin.html).`
                    : data?.rawText) ||
                fallbackMessage
        );
    }

    if (data === null || typeof data === "undefined") {
        throw new Error("Empty API response");
    }

    if (typeof data.rawText === "string") {
        throw new Error(
            "Unexpected non-JSON API response. Make sure the backend server is running and you are using the same port as the app."
        );
    }

    return data;
}

function closeAdminReschedulePanel() {
    activeAdminReschedule = null;

    if (adminReschedulePanel) {
        adminReschedulePanel.hidden = true;
    }

    if (adminRescheduleDateInput) {
        adminRescheduleDateInput.value = "";
    }

    if (adminRescheduleSlotsBody) {
        adminRescheduleSlotsBody.innerHTML = "";
    }

    if (adminRescheduleSaveButton) {
        adminRescheduleSaveButton.disabled = true;
    }

    if (adminRescheduleMessage) {
        adminRescheduleMessage.textContent = "";
    }
}

function selectAdminRescheduleTime(button, time) {
    if (!activeAdminReschedule || !adminRescheduleSlotsBody) {
        return;
    }

    activeAdminReschedule.selectedTime = time;

    const selectedStart = toMinutes(time);
    const selectedDuration = Number(activeAdminReschedule.durationMinutes) || 30;

    adminRescheduleSlotsBody.querySelectorAll("button").forEach((slotButton) => {
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

    if (adminRescheduleSaveButton) {
        adminRescheduleSaveButton.disabled = false;
    }
}

async function renderAdminRescheduleSlots(date) {
    if (!activeAdminReschedule || !adminRescheduleSlotsBody) {
        return;
    }

    activeAdminReschedule.selectedDate = date;
    activeAdminReschedule.selectedTime = "";

    if (adminRescheduleSaveButton) {
        adminRescheduleSaveButton.disabled = true;
    }

    adminRescheduleSlotsBody.innerHTML = "";
    const requestedDuration = Number(activeAdminReschedule.durationMinutes) || 30;
    const closeOfDay = toMinutes("18:00");

    try {
        const response = await fetch(`/api/appointments?date=${encodeURIComponent(date)}`);
        const appointments = await response.json().catch(() => null);

        if (!response.ok) {
            throw new Error(appointments?.error || "Unable to load appointments");
        }

        const rows = Array.isArray(appointments) ? appointments : [];
        const columnsPerRow = 4;
        let row = null;
        let skippedCurrent = false;

        adminRescheduleTimes.forEach((time, index) => {
            if (index % columnsPerRow === 0) {
                row = document.createElement("tr");
                adminRescheduleSlotsBody.appendChild(row);
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

            const conflict = rows.some((appointment) => {
                const appointmentTime = String(appointment?.time || "").slice(0, 5);
                const appointmentDuration = Number(appointment?.duration_minutes) || 30;

                if (
                    !skippedCurrent &&
                    date === activeAdminReschedule.currentDate &&
                    appointmentTime === activeAdminReschedule.currentTime &&
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

            button.addEventListener("click", () => selectAdminRescheduleTime(button, time));

            const cell = document.createElement("td");
            cell.appendChild(button);
            row.appendChild(cell);
        });

        if (adminRescheduleMessage) {
            adminRescheduleMessage.textContent =
                "Select a new time, then confirm reschedule.";
        }
    } catch (error) {
        if (adminRescheduleMessage) {
            adminRescheduleMessage.textContent = error.message;
        }
    }
}

function openAdminReschedulePanel(appointment) {
    if (!adminReschedulePanel || !adminRescheduleDateInput) {
        return;
    }

    activeAdminReschedule = {
        appointmentId: appointment.id,
        durationMinutes: Number(appointment.duration_minutes) || 30,
        currentDate: appointment.date || "",
        currentTime: String(appointment.time || "").slice(0, 5),
        selectedDate: "",
        selectedTime: ""
    };

    adminReschedulePanel.hidden = false;

    if (adminRescheduleTarget) {
        adminRescheduleTarget.textContent =
            `Current appointment: ${activeAdminReschedule.currentDate} at ${activeAdminReschedule.currentTime}`;
    }

    const today = new Date().toISOString().split("T")[0];
    adminRescheduleDateInput.min = today;
    adminRescheduleDateInput.value = activeAdminReschedule.currentDate || today;

    renderAdminRescheduleSlots(adminRescheduleDateInput.value);
    adminReschedulePanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function getAdminActionOptions(status) {
    const normalized = String(status || "").toLowerCase();

    if (normalized === "confirmed") {
        return [
            { value: "reschedule", label: "Reschedule" },
            { value: "cancel", label: "Cancel" },
            { value: "no_show", label: "No-show" },
            { value: "late", label: "Late" }
        ];
    }

    if (normalized === "late") {
        return [
            { value: "reschedule", label: "Reschedule" },
            { value: "cancel", label: "Cancel" },
            { value: "no_show", label: "No-show" }
        ];
    }

    return [];
}

function parseAppointmentDateTime(appointment) {
    const dateText = String(appointment?.date || "").trim();
    const timeText = String(appointment?.time || "").trim();

    if (!dateText || !timeText) {
        return null;
    }

    const parsed = new Date(`${dateText}T${timeText}:00`);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }

    return parsed;
}

function isUpcomingAppointment(appointment) {
    const status = String(appointment?.status || "").toLowerCase();
    if (status !== "confirmed" && status !== "late") {
        return false;
    }

    const appointmentDateTime = parseAppointmentDateTime(appointment);
    if (!appointmentDateTime) {
        return false;
    }

    return appointmentDateTime.getTime() >= Date.now();
}

function getAppointmentTimestamp(appointment) {
    const appointmentDateTime = parseAppointmentDateTime(appointment);
    return appointmentDateTime ? appointmentDateTime.getTime() : null;
}

async function performAdminAppointmentAction(appointment, action) {
    switch (action) {
        case "reschedule":
            openAdminReschedulePanel(appointment);
            return;
        case "cancel": {
            const shouldCancel = window.confirm(
                "Are you sure you want to cancel this appointment?"
            );

            if (!shouldCancel) {
                return;
            }

            const cancelResult = await fetchAdminJson(`/api/admin/appointments/${appointment.id}/cancel`, {
                method: "POST"
            });

            const cancelFeePercent = Number(cancelResult?.feePercent) || 0;
            const cancelRefundedCents = Number(cancelResult?.settlement?.refundedCents) || 0;
            const cancelKeptCents = Number(cancelResult?.settlement?.keptCents) || 0;

            if (cancelFeePercent > 0) {
                setAdminMessage(
                    `Appointment cancelled. ${cancelFeePercent}% fee kept (${formatCurrency(cancelKeptCents)}), refunded ${formatCurrency(cancelRefundedCents)}.`
                );
            } else {
                setAdminMessage(
                    `Appointment cancelled. Refunded ${formatCurrency(cancelRefundedCents)}.`
                );
            }
            break;
        }
        case "no_show": {
            const noShowResult = await fetchAdminJson(`/api/admin/appointments/${appointment.id}/no-show`, {
                method: "POST"
            });

            const noShowFeePercent = Number(noShowResult?.feePercent) || 50;
            const noShowRefundedCents = Number(noShowResult?.settlement?.refundedCents) || 0;
            const noShowKeptCents = Number(noShowResult?.settlement?.keptCents) || 0;

            setAdminMessage(
                `Appointment marked as no-show. ${noShowFeePercent}% fee kept (${formatCurrency(noShowKeptCents)}), refunded ${formatCurrency(noShowRefundedCents)}.`
            );
            break;
        }
        case "late":
            await fetchAdminJson(`/api/admin/appointments/${appointment.id}/late`, {
                method: "POST"
            });
            setAdminMessage("Appointment marked as late.");
            break;
        default:
            throw new Error("Select an action first.");
    }

    await Promise.all([loadAppointments(), loadAnalytics(), loadFinance()]);
}

function renderAppointments(appointments) {
    appointmentsTableBody.innerHTML = "";
    if (pastAppointmentsTableBody) {
        pastAppointmentsTableBody.innerHTML = "";
    }

    closeAdminReschedulePanel();

    if (!appointments || appointments.length === 0) {
        const row = document.createElement("tr");
        const cell = document.createElement("td");
        cell.colSpan = 8;
        cell.textContent = "No upcoming appointments found.";
        row.appendChild(cell);
        appointmentsTableBody.appendChild(row);

        if (pastAppointmentsTableBody) {
            const pastRow = document.createElement("tr");
            const pastCell = document.createElement("td");
            pastCell.colSpan = 8;
            pastCell.textContent = "No past appointments found.";
            pastRow.appendChild(pastCell);
            pastAppointmentsTableBody.appendChild(pastRow);
        }
        return;
    }

    const upcomingAppointments = appointments.filter((appointment) =>
        isUpcomingAppointment(appointment)
    );
    const pastAppointments = appointments.filter(
        (appointment) => !isUpcomingAppointment(appointment)
    );

    upcomingAppointments.sort((left, right) => {
        const leftTimestamp = getAppointmentTimestamp(left);
        const rightTimestamp = getAppointmentTimestamp(right);

        if (leftTimestamp === null && rightTimestamp === null) {
            return Number(left.id) - Number(right.id);
        }

        if (leftTimestamp === null) {
            return 1;
        }

        if (rightTimestamp === null) {
            return -1;
        }

        return leftTimestamp - rightTimestamp;
    });

    pastAppointments.sort((left, right) => {
        const leftTimestamp = getAppointmentTimestamp(left);
        const rightTimestamp = getAppointmentTimestamp(right);

        if (leftTimestamp === null && rightTimestamp === null) {
            return Number(right.id) - Number(left.id);
        }

        if (leftTimestamp === null) {
            return 1;
        }

        if (rightTimestamp === null) {
            return -1;
        }

        return rightTimestamp - leftTimestamp;
    });

    const renderAppointmentRow = (appointment, targetTableBody) => {
        if (!targetTableBody) {
            return;
        }

        const row = document.createElement("tr");
        const services = (() => {
            try {
                return JSON.parse(appointment.services || "[]")
                    .map((service) => escapeHtml(service?.name || ""))
                    .join(", ");
            } catch (err) {
                return "";
            }
        })();

        row.innerHTML = `
            <td>${escapeHtml(appointment.date || "-")}</td>
            <td>${escapeHtml(appointment.time || "-")}</td>
            <td>${escapeHtml(appointment.name || "-")}</td>
            <td>${escapeHtml(appointment.email || "-")}</td>
            <td>${escapeHtml(appointment.phone || "-")}</td>
            <td>${services || "-"}</td>
            <td>${escapeHtml(appointment.status || "-")}</td>
            <td></td>
        `;

        const actionCell = row.querySelector("td:last-child");
        const controls = document.createElement("div");
        controls.className = "admin-action-controls";

        const actionSelect = document.createElement("select");
        actionSelect.className = "admin-action-select";
        actionSelect.setAttribute("aria-label", `Select action for appointment ${appointment.id}`);

        const placeholderOption = document.createElement("option");
        placeholderOption.value = "";
        placeholderOption.textContent = "Action";
        placeholderOption.hidden = true;
        placeholderOption.selected = true;
        actionSelect.appendChild(placeholderOption);

        const options = getAdminActionOptions(appointment.status);
        options.forEach((option) => {
            const optionElement = document.createElement("option");
            optionElement.value = option.value;
            optionElement.textContent = option.label;
            actionSelect.appendChild(optionElement);
        });

        const confirmButton = document.createElement("button");
        confirmButton.type = "button";
        confirmButton.textContent = "Confirm";
        confirmButton.className = "admin-action-confirm";
        confirmButton.disabled = options.length === 0;

        if (options.length === 0) {
            actionSelect.disabled = true;
        } else {
            confirmButton.disabled = true;
        }

        actionSelect.addEventListener("change", () => {
            confirmButton.disabled = !actionSelect.value;
        });

        confirmButton.addEventListener("click", async () => {
            try {
                confirmButton.disabled = true;
                await performAdminAppointmentAction(appointment, actionSelect.value);
            } catch (error) {
                setAdminMessage(error.message || "Unable to update appointment");
                confirmButton.disabled = !actionSelect.value;
            }
        });

        controls.appendChild(actionSelect);
        controls.appendChild(confirmButton);
        actionCell.appendChild(controls);
        targetTableBody.appendChild(row);
    };

    if (upcomingAppointments.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="8">No upcoming appointments found.</td>';
        appointmentsTableBody.appendChild(row);
    } else {
        upcomingAppointments.forEach((appointment) => {
            renderAppointmentRow(appointment, appointmentsTableBody);
        });
    }

    if (pastAppointmentsTableBody) {
        if (pastAppointments.length === 0) {
            const row = document.createElement("tr");
            row.innerHTML = '<td colspan="8">No past appointments found.</td>';
            pastAppointmentsTableBody.appendChild(row);
        } else {
            pastAppointments.forEach((appointment) => {
                renderAppointmentRow(appointment, pastAppointmentsTableBody);
            });
        }
    }
}

function renderFinance(finance) {
    const totals = finance?.totals || {};
    const expenses = finance?.expenses || [];

    metricConfirmedRevenue.textContent = formatCurrency(totals.confirmedRevenueCents || 0);
    metricCancelFees.textContent = formatCurrency(totals.cancellationFeesCents || 0);
    metricNoShowFees.textContent = formatCurrency(totals.noShowFeesCents || 0);
    metricExpenses.textContent = formatCurrency(totals.expensesCents || 0);
    metricNetRevenue.textContent = formatCurrency(totals.netRevenueCents || 0);

    expensesTableBody.innerHTML = "";
    if (expenses.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="5">No expenses in selected range.</td>';
        expensesTableBody.appendChild(row);
        return;
    }

    expenses.forEach((expense) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${escapeHtml(expense.date || "-")}</td>
            <td>${escapeHtml(expense.category || "-")}</td>
            <td>${escapeHtml(expense.description || "-")}</td>
            <td>${formatCurrency(expense.amount_cents || 0)}</td>
            <td></td>
        `;

        const actionCell = row.querySelector("td:last-child");
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "cart-remove-btn";
        removeButton.textContent = "Remove";
        removeButton.setAttribute("aria-label", `Remove expense ${expense.category || "entry"}`);

        removeButton.addEventListener("click", async () => {
            const expenseId = Number(expense?.id);
            if (!Number.isInteger(expenseId)) {
                setAdminMessage("Unable to remove this expense.");
                return;
            }

            const shouldRemove = window.confirm(
                "Are you sure you would like to remove this expense?"
            );

            if (!shouldRemove) {
                return;
            }

            removeButton.disabled = true;
            try {
                await fetchAdminJson(`/api/admin/expenses/${expenseId}`, {
                    method: "DELETE"
                });
                setAdminMessage("Expense removed.");
                await loadFinance();
                showExpenseUndoToast(expense);
            } catch (error) {
                setAdminMessage(error.message || "Unable to remove expense");
                removeButton.disabled = false;
            }
        });

        actionCell.appendChild(removeButton);
        expensesTableBody.appendChild(row);
    });
}

function renderDailyAnalytics(dailyRows) {
    dailyAnalyticsBody.innerHTML = "";

    if (!dailyRows || dailyRows.length === 0) {
        if (dailyToggleBtn) {
            dailyToggleBtn.hidden = true;
        }
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="5">No analytics data found.</td>';
        dailyAnalyticsBody.appendChild(row);
        return;
    }

    const visibleRows = dailyExpanded
        ? dailyRows
        : dailyRows.slice(Math.max(0, dailyRows.length - DAILY_VISIBLE_ROWS));

    if (dailyToggleBtn) {
        dailyToggleBtn.hidden = dailyRows.length <= DAILY_VISIBLE_ROWS;
        dailyToggleBtn.textContent = dailyExpanded ? "Show fewer days" : "Show all days";
    }

    visibleRows.forEach((rowData) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${escapeHtml(rowData.date || "-")}</td>
            <td>${rowData.appointments ?? 0}</td>
            <td>${rowData.confirmed ?? 0}</td>
            <td>${rowData.cancelled ?? 0}</td>
            <td>${formatCurrency(rowData.revenueCents || 0)}</td>
        `;
        dailyAnalyticsBody.appendChild(row);
    });
}

function renderTopServices(services) {
    topServicesBody.innerHTML = "";

    if (!services || services.length === 0) {
        const row = document.createElement("tr");
        row.innerHTML = '<td colspan="3">No services in selected range.</td>';
        topServicesBody.appendChild(row);
        return;
    }

    services.forEach((service) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${escapeHtml(service.name || "-")}</td>
            <td>${service.count ?? 0}</td>
            <td>${formatCurrency(service.revenueCents || 0)}</td>
        `;
        topServicesBody.appendChild(row);
    });
}

function renderAnalytics(analytics) {
    const totals = analytics?.totals || {};

    metricAppointments.textContent = `${totals.appointments ?? 0}`;
    metricConfirmed.textContent = `${totals.confirmed ?? 0}`;
    metricCancelled.textContent = `${totals.cancelled ?? 0}`;
    metricRevenue.textContent = formatCurrency(totals.revenueCents || 0);
    metricAvgTicket.textContent = formatCurrency(totals.avgTicketCents || 0);
    metricCompletionRate.textContent = formatPercent(totals.completionRate || 0);

    renderDailyAnalytics(analytics?.daily || []);
    renderTopServices(analytics?.topServices || []);
}

async function loadAppointments() {
    const appointments = await fetchAdminJson("/api/admin/appointments");
    renderAppointments(appointments);
}

adminRescheduleDateInput?.addEventListener("change", () => {
    if (!adminRescheduleDateInput.value || !activeAdminReschedule) {
        return;
    }
    renderAdminRescheduleSlots(adminRescheduleDateInput.value);
});

adminRescheduleCancelButton?.addEventListener("click", () => {
    closeAdminReschedulePanel();
});

adminRescheduleSaveButton?.addEventListener("click", async () => {
    if (
        !activeAdminReschedule?.appointmentId ||
        !activeAdminReschedule.selectedDate ||
        !activeAdminReschedule.selectedTime
    ) {
        if (adminRescheduleMessage) {
            adminRescheduleMessage.textContent = "Select a date and time to continue.";
        }
        return;
    }

    adminRescheduleSaveButton.disabled = true;

    try {
        await fetchAdminJson(
            `/api/admin/appointments/${activeAdminReschedule.appointmentId}/reschedule`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    date: activeAdminReschedule.selectedDate,
                    time: activeAdminReschedule.selectedTime
                })
            }
        );

        setAdminMessage("Appointment rescheduled.");
        closeAdminReschedulePanel();
        await Promise.all([loadAppointments(), loadAnalytics(), loadFinance()]);
    } catch (error) {
        if (adminRescheduleMessage) {
            adminRescheduleMessage.textContent = error.message || "Unable to reschedule";
        }
        adminRescheduleSaveButton.disabled = false;
    }
});

async function loadAnalytics() {
    const start = analyticsStartInput?.value;
    const end = analyticsEndInput?.value;
    const query = new URLSearchParams({ start, end });
    const analytics = await fetchAdminJson(`/api/admin/analytics?${query.toString()}`);
    renderAnalytics(analytics);
}

async function loadFinance() {
    const start = analyticsStartInput?.value;
    const end = analyticsEndInput?.value;
    const query = new URLSearchParams({ start, end });
    const finance = await fetchAdminJson(`/api/admin/finance?${query.toString()}`);
    renderFinance(finance);
}

async function loadDashboard() {
    await Promise.all([loadAppointments(), loadAnalytics(), loadFinance()]);

    if (reportsSection) {
        reportsSection.hidden = false;
    }

    if (financeSection) {
        financeSection.hidden = false;
    }
}

async function restoreAdminSession() {
    try {
        await fetchAdminJson("/api/admin/session");
        setAuthenticatedLayout(true);
        setAdminMessage("Loading dashboard...");
        await loadDashboard();
        setAdminMessage("Dashboard loaded.");
    } catch (error) {
        setAuthenticatedLayout(false);
        if (reportsSection) {
            reportsSection.hidden = true;
        }
        if (financeSection) {
            financeSection.hidden = true;
        }
    }
}

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const username = adminUserInput.value.trim();
    const password = adminPassInput.value.trim();

    if (!username || !password) {
        setAdminMessage("Please enter your admin credentials.");
        return;
    }

    try {
        setAdminMessage("Signing in...");
        await fetchAdminJson("/api/admin/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username, password })
        });

        await loadDashboard();
        setAuthenticatedLayout(true);
        adminPassInput.value = "";
        setAdminMessage("Dashboard loaded.");
    } catch (error) {
        setAuthenticatedLayout(false);
        setAdminMessage(error.message || "Unable to load dashboard");
        renderAppointments([]);
        renderAnalytics({});
        renderFinance({});
        if (reportsSection) {
            reportsSection.hidden = true;
        }
        if (financeSection) {
            financeSection.hidden = true;
        }
    }
});

analyticsFilterForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isAdminAuthenticated) {
        setAdminMessage("Sign in to view analytics.");
        return;
    }

    try {
        setAdminMessage("Refreshing analytics...");
        await Promise.all([loadAnalytics(), loadFinance()]);
        setAdminMessage("Analytics refreshed.");
    } catch (error) {
        setAdminMessage(error.message || "Unable to refresh analytics");
    }
});

dailyToggleBtn?.addEventListener("click", () => {
    dailyExpanded = !dailyExpanded;
    Promise.all([loadAnalytics(), loadFinance()]).catch((error) => {
        setAdminMessage(error.message || "Unable to refresh analytics");
    });
});

expenseForm?.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!isAdminAuthenticated) {
        setAdminMessage("Sign in to add expenses.");
        return;
    }

    try {
        await fetchAdminJson("/api/admin/expenses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                date: expenseDateInput?.value,
                category: expenseCategoryInput?.value,
                amount: Number(expenseAmountInput?.value || 0),
                description: expenseDescriptionInput?.value || ""
            })
        });

        expenseForm.reset();
        if (expenseDateInput) {
            expenseDateInput.value = analyticsEndInput?.value || toIsoDate(new Date());
        }

        await loadFinance();
        setAdminMessage("Expense added.");
    } catch (error) {
        setAdminMessage(error.message || "Unable to save expense");
    }
});

adminLogoutButton?.addEventListener("click", async () => {
    try {
        await fetchAdminJson("/api/admin/logout", {
            method: "POST"
        });
    } catch (error) {
        // Ignore logout failures and still clear the UI state.
    }

    renderAppointments([]);
    renderAnalytics({});
    renderFinance({});
    closeAdminReschedulePanel();
    dismissExpenseUndoToast();
    setAuthenticatedLayout(false);
    if (reportsSection) {
        reportsSection.hidden = true;
    }
    if (financeSection) {
        financeSection.hidden = true;
    }
    setAdminMessage("Signed out.");
});

setDefaultDateRange();
setAuthenticatedLayout(false);

if (expenseDateInput) {
    expenseDateInput.value = toIsoDate(new Date());
}

restoreAdminSession();
