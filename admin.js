const loginForm = document.getElementById("admin-login");
const adminUserInput = document.getElementById("admin-user");
const adminPassInput = document.getElementById("admin-pass");
const loginSection = document.getElementById("admin-login-section");
const dashboardSection = document.getElementById("admin-dashboard");
const adminMessage = document.getElementById("admin-message");
const dashboardMessage = document.getElementById("dashboard-message");
const appointmentsTableBody = document.querySelector("#appointments-table tbody");
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

let authHeader = "";
let dailyExpanded = false;
const DAILY_VISIBLE_ROWS = 1;

function setAdminMessage(message) {
    const isLoggedIn = loginSection?.hidden;
    const target = isLoggedIn ? dashboardMessage : adminMessage;

    if (target) {
        target.textContent = message;
    }
}

function setAuthenticatedLayout(isAuthenticated) {
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

function buildAuthHeader() {
    const user = adminUserInput.value.trim();
    const pass = adminPassInput.value.trim();

    if (!user || !pass) {
        return "";
    }

    return `Basic ${btoa(`${user}:${pass}`)}`;
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
    const response = await fetch(url, {
        ...options,
        headers: {
            ...(options.headers || {}),
            Authorization: authHeader
        }
    });

    const data = await parseApiResponse(response);

    if (!response.ok) {
        const fallbackMessage =
            response.status === 401 || response.status === 403
                ? "Invalid admin credentials."
                : "Request failed";

        throw new Error(
            data?.error ||
                data?.message ||
                (typeof data?.rawText === "string" && data.rawText.trim().startsWith("<")
                    ? "API returned HTML instead of JSON. Make sure you opened admin from the Node server URL (http://localhost:5500/admin.html)."
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
        const cancelButton = document.createElement("button");
        cancelButton.type = "button";
        cancelButton.textContent = "Cancel";
        cancelButton.disabled = appointment.status !== "confirmed";

        const noShowButton = document.createElement("button");
        noShowButton.type = "button";
        noShowButton.textContent = "No-show";
        noShowButton.disabled = appointment.status !== "confirmed";

        const reverseNoShowButton = document.createElement("button");
        reverseNoShowButton.type = "button";
        reverseNoShowButton.textContent = "Reverse No-show";
        reverseNoShowButton.disabled = appointment.status !== "no_show";

        cancelButton.addEventListener("click", async () => {
            try {
                const response = await fetch(`/api/admin/appointments/${appointment.id}/cancel`, {
                    method: "POST",
                    headers: { Authorization: authHeader }
                });

                const data = await parseApiResponse(response);

                if (!response.ok) {
                    throw new Error(data?.error || data?.message || "Failed to cancel appointment");
                }

                setAdminMessage("Appointment cancelled.");
                await Promise.all([loadAppointments(), loadAnalytics(), loadFinance()]);
            } catch (error) {
                setAdminMessage(error.message);
            }
        });

        noShowButton.addEventListener("click", async () => {
            try {
                const response = await fetch(`/api/admin/appointments/${appointment.id}/no-show`, {
                    method: "POST",
                    headers: { Authorization: authHeader }
                });

                const data = await parseApiResponse(response);
                if (!response.ok) {
                    throw new Error(data?.error || data?.message || "Failed to mark no-show");
                }

                setAdminMessage("Appointment marked as no-show.");
                await Promise.all([loadAppointments(), loadAnalytics(), loadFinance()]);
            } catch (error) {
                setAdminMessage(error.message);
            }
        });

        reverseNoShowButton.addEventListener("click", async () => {
            try {
                const response = await fetch(`/api/admin/appointments/${appointment.id}/reverse-no-show`, {
                    method: "POST",
                    headers: { Authorization: authHeader }
                });

                const data = await parseApiResponse(response);
                if (!response.ok) {
                    throw new Error(data?.error || data?.message || "Failed to reverse no-show");
                }

                setAdminMessage("No-show reversed to confirmed.");
                await Promise.all([loadAppointments(), loadAnalytics(), loadFinance()]);
            } catch (error) {
                setAdminMessage(error.message);
            }
        });

        actionCell.appendChild(cancelButton);
        actionCell.appendChild(noShowButton);
        actionCell.appendChild(reverseNoShowButton);
        appointmentsTableBody.appendChild(row);
    });
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
        row.innerHTML = '<td colspan="4">No expenses in selected range.</td>';
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
        `;
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

loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    authHeader = buildAuthHeader();

    if (!authHeader) {
        setAdminMessage("Please enter your admin credentials.");
        return;
    }

    try {
        setAdminMessage("Loading dashboard...");
        await loadDashboard();
        setAuthenticatedLayout(true);
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

    if (!authHeader) {
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

    if (!authHeader) {
        setAdminMessage("Sign in to add expenses.");
        return;
    }

    try {
        const response = await fetch("/api/admin/expenses", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: authHeader
            },
            body: JSON.stringify({
                date: expenseDateInput?.value,
                category: expenseCategoryInput?.value,
                amount: Number(expenseAmountInput?.value || 0),
                description: expenseDescriptionInput?.value || ""
            })
        });

        const data = await parseApiResponse(response);
        if (!response.ok) {
            throw new Error(data?.error || data?.message || "Unable to save expense");
        }

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

setDefaultDateRange();
setAuthenticatedLayout(false);

if (expenseDateInput) {
    expenseDateInput.value = toIsoDate(new Date());
}
