const dateInput = document.getElementById("date");
const timeSlotsContainer = document.getElementById("time-slots");
const cartItemsContainer = document.getElementById("cart-items");
const totalSpan = document.getElementById("total");
const payBtn = document.getElementById("pay-btn");
const bookingDetailsDiv = document.getElementById("booking-details");
const bookingDateSpan = document.getElementById("booking-date");
const bookingTimeSpan = document.getElementById("booking-time");
const bookingDurationSpan = document.getElementById("booking-duration");
const bookingForm = document.getElementById("booking-form");
const nameInput = document.getElementById("client-name");
const emailInput = document.getElementById("client-email");
const phoneInput = document.getElementById("client-phone");
const referralEmailInput = document.getElementById("referral-email");
const formMessage = document.getElementById("form-message");
const PENDING_BOOKING_KEY = "pendingBookingDraft";

let selectedDate = null;
let selectedTime = null;
let cart = [];
let total = 0;
let appliedSpecials = null; // result from /api/booking/preview-specials

function persistCartState() {
    localStorage.setItem("cart", JSON.stringify(cart));
    localStorage.setItem("total", String(total));
}

/** Recomputes `total` from cart base prices + any active specials. */
function recomputeTotal() {
    let base = cart.reduce((sum, item) => sum + Number(item.price || 0), 0);
    if (appliedSpecials) {
        const overrides = appliedSpecials.priceOverridesCents || {};
        for (const item of cart) {
            if (overrides[item.id] !== undefined) {
                base -= Number(item.price || 0);
                base += overrides[item.id] / 100;
            }
        }
        base = Math.max(0, base - (appliedSpecials.flatDiscountCents || 0) / 100);
        if (appliedSpecials.isFree) base = 0;
    }
    total = Math.round(base);
    persistCartState();
}

/** Fetches applicable specials from the server and re-renders the cart. */
async function fetchAndApplySpecials() {
    const email = emailInput?.value?.trim() || "";
    const referralEmail = referralEmailInput?.value?.trim() || "";

    if (!email || cart.length === 0) {
        appliedSpecials = null;
        renderCheckoutCart();
        return;
    }

    try {
        const params = new URLSearchParams({
            email,
            referralEmail,
            services: JSON.stringify(cart)
        });
        const response = await fetch(`/api/booking/preview-specials?${params}`);
        appliedSpecials = response.ok ? await response.json() : null;
    } catch (e) {
        appliedSpecials = null;
    }
    renderCheckoutCart();
}

function renderCheckoutCart() {
    cartItemsContainer.innerHTML = "";

    cart.forEach((item, index) => {
        const li = document.createElement("li");

        // Show overridden price for this item if a special applies
        const overrideCents = appliedSpecials?.priceOverridesCents?.[item.id];
        const displayPrice = overrideCents !== undefined ? (overrideCents / 100).toFixed(0) : item.price;
        const priceHasChanged = overrideCents !== undefined && overrideCents !== item.price * 100;

        const itemText = document.createElement("span");
        if (priceHasChanged) {
            itemText.innerHTML = `${item.name} - <s>$${item.price}</s> <strong>$${displayPrice}</strong>`;
        } else {
            itemText.textContent = `${item.name} - $${displayPrice}`;
        }

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "cart-remove-btn";
        removeButton.textContent = "Remove";
        removeButton.setAttribute("aria-label", `Remove ${item.name} from cart`);
        removeButton.addEventListener("click", () => removeFromCheckoutCart(index));

        li.appendChild(itemText);
        li.appendChild(removeButton);
        cartItemsContainer.appendChild(li);
    });

    // Show applied specials
    const specialsBox = document.getElementById("specials-applied");
    const specialsList = document.getElementById("specials-applied-list");
    if (specialsBox && specialsList) {
        const specials = appliedSpecials?.specials || [];
        if (specials.length > 0) {
            specialsList.innerHTML = "";
            specials.forEach((s) => {
                const li = document.createElement("li");
                li.textContent = s.label;
                specialsList.appendChild(li);
            });
            specialsBox.style.display = "block";
        } else {
            specialsBox.style.display = "none";
        }
    }

    recomputeTotal();
    totalSpan.textContent = String(total);

    // Update pay button label for free bookings
    if (payBtn) {
        payBtn.textContent = appliedSpecials?.isFree
            ? "Confirm Free Booking"
            : "Pay & Confirm Booking";
    }
}

function removeFromCheckoutCart(index) {
    const [removedItem] = cart.splice(index, 1);
    if (!removedItem) {
        return;
    }

    // recomputeTotal() will be called inside renderCheckoutCart()
    renderCheckoutCart();

    if (formMessage) {
        formMessage.textContent = "Removed from cart.";
    }

    if (cart.length === 0) {
        selectedTime = null;
        bookingDetailsDiv.style.display = "none";
        timeSlotsContainer.innerHTML = "";
        payBtn.disabled = true;
        if (formMessage) {
            formMessage.textContent = "Your cart is empty. Please return to Home to add services.";
        }
        return;
    }

    if (selectedDate) {
        selectedTime = null;
        bookingDetailsDiv.style.display = "none";
        generateTimeSlots(selectedDate);
    }

    updatePayButtonState();
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

function getRequestedDuration() {
    return cart.reduce((sum, service) => {
        const duration = Number(service?.duration);
        return sum + (Number.isInteger(duration) && duration > 0 ? duration : 30);
    }, 0);
}

function highlightSelectedBlock(startTime) {
    const requestedDuration = getRequestedDuration();
    const startMinutes = toMinutes(startTime);

    document.querySelectorAll(".time-slots button").forEach((button) => {
        button.classList.remove("selected", "selected-range");
        button.setAttribute("aria-pressed", "false");

        const buttonMinutes = toMinutes(button.textContent.trim());
        if (startMinutes === null || buttonMinutes === null) {
            return;
        }

        const inSelectedBlock =
            buttonMinutes >= startMinutes && buttonMinutes < startMinutes + requestedDuration;

        if (!inSelectedBlock) {
            return;
        }

        if (buttonMinutes === startMinutes) {
            button.classList.add("selected");
            button.setAttribute("aria-pressed", "true");
        } else {
            button.classList.add("selected-range");
        }
    });
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

// Load cart from localStorage
function loadCart() {
    localStorage.removeItem(PENDING_BOOKING_KEY);
    const savedCart = localStorage.getItem("cart");

    if (savedCart) {
        try {
            cart = JSON.parse(savedCart);
        } catch (e) {
            cart = [];
        }
    }

    renderCheckoutCart();

    if (cart.length === 0) {
        if (formMessage) {
            formMessage.textContent = "Your cart is empty. Please return to Home to add services.";
        }
        payBtn.disabled = true;
        timeSlotsContainer.innerHTML = "";
        bookingDetailsDiv.style.display = "none";
    } else {
        // Fetch specials if email is already filled (e.g. back-navigation)
        const prefilledEmail = emailInput?.value?.trim() || "";
        if (prefilledEmail) {
            fetchAndApplySpecials();
        }
    }
}

const times = buildTimeSlots(9, 18, 15);

// Generate time buttons
function generateTimeSlots(date) {
    selectedDate = date;
    timeSlotsContainer.innerHTML = ""; // Clear previous slots
    
    // Fetch booked appointments for this date
    fetch(`/api/appointments?date=${encodeURIComponent(date)}`)
        .then(async (res) => {
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || "Unable to load appointments");
            }
            return data;
        })
        .then(appointments => {
            const requestedDuration = getRequestedDuration();
            const closeOfDay = toMinutes("18:00");
            const columnsPerRow = 4;

            let row = null;

            times.forEach((time, index) => {
                if (index % columnsPerRow === 0) {
                    row = document.createElement("tr");
                    timeSlotsContainer.appendChild(row);
                }

                const btn = document.createElement("button");
                btn.textContent = time;
                btn.setAttribute("type", "button");
                btn.setAttribute("aria-pressed", "false");

                const slotStart = toMinutes(time);
                const exceedsBusinessHours =
                    slotStart === null || closeOfDay === null
                        ? true
                        : slotStart + requestedDuration > closeOfDay;
                const conflict = appointments.some((apt) => {
                    if (apt.date !== date) return false;

                    const bookedStart = toMinutes(apt.time);
                    const bookedDuration = Number(apt.duration_minutes) || 30;

                    if (slotStart === null || bookedStart === null) {
                        return false;
                    }

                    return rangesOverlap(slotStart, requestedDuration, bookedStart, bookedDuration);
                });

                if (conflict || exceedsBusinessHours) {
                    btn.disabled = true;
                    btn.classList.add("disabled");
                    btn.setAttribute("aria-disabled", "true");
                }

                btn.addEventListener("click", () => selectTime(btn, time));

                const cell = document.createElement("td");
                cell.appendChild(btn);
                row.appendChild(cell);
            });
        })
        .catch(err => {
            console.error("Error fetching appointments:", err);
            if (formMessage) {
                formMessage.textContent = err.message || "Unable to load appointments.";
            }
        });
}

function selectTime(btn, time) {
    selectedTime = time;
    highlightSelectedBlock(time);
    
    // Show booking details
    bookingDetailsDiv.style.display = "block";
    bookingDateSpan.textContent = selectedDate;
    bookingTimeSpan.textContent = selectedTime;
    bookingDurationSpan.textContent = String(getRequestedDuration());

    updatePayButtonState();
}

// Set minimum date to today
const today = new Date().toISOString().split('T')[0];
dateInput.min = today;

// Trigger when date changes
dateInput.addEventListener("change", () => {
    if (!dateInput.value) return;
    payBtn.disabled = true;
    selectedTime = null;
    bookingDetailsDiv.style.display = "none";
    generateTimeSlots(dateInput.value);
});

function updatePayButtonState() {
    const isFormValid =
        nameInput.value.trim().length > 0 &&
        emailInput.value.trim().length > 0 &&
        phoneInput.value.trim().length > 0;

    payBtn.disabled = !(cart.length > 0 && isFormValid && selectedDate && selectedTime);
}

bookingForm.addEventListener("input", () => {
    if (formMessage) {
        formMessage.textContent = "";
    }
    updatePayButtonState();
});

// Re-fetch specials when the user finishes typing their email or referral email
emailInput?.addEventListener("blur", () => { fetchAndApplySpecials(); });
referralEmailInput?.addEventListener("blur", () => { fetchAndApplySpecials(); });

// Payment button
payBtn.addEventListener("click", async () => {
    if (cart.length === 0) {
        if (formMessage) {
            formMessage.textContent = "Your cart is empty. Please return to Home to add services.";
        }
        return;
    }

    if (!selectedDate || !selectedTime) {
        if (formMessage) {
            formMessage.textContent = "Please select a date and time first.";
        }
        return;
    }

    if (!nameInput.value.trim() || !emailInput.value.trim() || !phoneInput.value.trim()) {
        if (formMessage) {
            formMessage.textContent = "Please complete your contact details.";
        }
        return;
    }

    const referralEmail = referralEmailInput?.value?.trim() || "";
    if (referralEmail && !/^\S+@\S+\.\S+$/.test(referralEmail)) {
        if (formMessage) {
            formMessage.textContent = "Please enter a valid referral email or leave it blank.";
        }
        return;
    }

    payBtn.disabled = true;
    payBtn.textContent = "Continuing...";
    payBtn.setAttribute("aria-busy", "true");

    try {
        // Re-fetch specials one final time before storing (in case form was updated)
        if (emailInput.value.trim()) {
            await fetchAndApplySpecials();
        }

        localStorage.setItem(
            PENDING_BOOKING_KEY,
            JSON.stringify({
                amount: total * 100,
                date: selectedDate,
                time: selectedTime,
                services: cart,
                isFree: appliedSpecials?.isFree || false,
                appliedSpecials: appliedSpecials || null,
                customer: {
                    name: nameInput.value.trim(),
                    email: emailInput.value.trim(),
                    phone: phoneInput.value.trim(),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                    referralEmail
                }
            })
        );

        window.location.href = "consent.html";
    } catch (error) {
        console.error("Error:", error);
        if (formMessage) {
            formMessage.textContent = `Error: ${error.message}`;
        }
        payBtn.disabled = false;
        payBtn.textContent = appliedSpecials?.isFree ? "Confirm Free Booking" : "Pay & Confirm Booking";
        payBtn.removeAttribute("aria-busy");
    }
});

// Initialize
loadCart();
updatePayButtonState();
