const dateInput = document.getElementById("date");
const timeSlotsContainer = document.getElementById("time-slots");
const cartItemsContainer = document.getElementById("cart-items");
const totalSpan = document.getElementById("total");
const payBtn = document.getElementById("pay-btn");
const bookingDetailsDiv = document.getElementById("booking-details");
const bookingDateSpan = document.getElementById("booking-date");
const bookingTimeSpan = document.getElementById("booking-time");
const bookingForm = document.getElementById("booking-form");
const nameInput = document.getElementById("client-name");
const emailInput = document.getElementById("client-email");
const phoneInput = document.getElementById("client-phone");
const formMessage = document.getElementById("form-message");

let selectedDate = null;
let selectedTime = null;
let cart = [];
let total = 0;
let stripe = null;

// Load Stripe with public key from server
async function initStripe() {
    try {
        const response = await fetch("/api/stripe-public-key");
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "Stripe configuration error");
        }
        const { publicKey } = data;
        stripe = Stripe(publicKey);
    } catch (error) {
        console.error("Failed to load Stripe:", error);
        payBtn.disabled = true;
        if (formMessage) {
            formMessage.textContent = "Payment system unavailable. Please try again later.";
        }
    }
}

// Load cart from localStorage
function loadCart() {
    const savedCart = localStorage.getItem("cart");
    const savedTotal = localStorage.getItem("total");
    
    if (savedCart) {
        cart = JSON.parse(savedCart);
        total = parseInt(savedTotal) || 0;
    }
    
    // Display cart items
    cartItemsContainer.innerHTML = "";
    cart.forEach(item => {
        const li = document.createElement("li");
        li.textContent = `${item.name} - $${item.price}`;
        cartItemsContainer.appendChild(li);
    });
    
    totalSpan.textContent = total;
    
    if (cart.length === 0) {
        if (formMessage) {
            formMessage.textContent = "No services selected. Please go back to select services.";
        }
        window.location.href = "index.html";
    }
}

// Example: available times
const times = [
    "09:00","09:30","10:00","10:30",
    "11:00","11:30","12:00","12:30",
    "13:00","13:30","14:00","14:30",
    "15:00","15:30","16:00","16:30"
];

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
            times.forEach(time => {
                const btn = document.createElement("button");
                btn.textContent = time;
                btn.setAttribute("type", "button");
                btn.setAttribute("aria-pressed", "false");

                // Disable if already booked
                const conflict = appointments.some(apt => apt.date === date && apt.time === time);
                if (conflict) {
                    btn.disabled = true;
                    btn.classList.add("disabled");
                    btn.setAttribute("aria-disabled", "true");
                }

                btn.addEventListener("click", () => selectTime(btn, time));
                timeSlotsContainer.appendChild(btn);
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
    // Remove previous selection
    document.querySelectorAll(".time-slots button").forEach(b => {
        b.classList.remove("selected");
        b.setAttribute("aria-pressed", "false");
    });
    btn.classList.add("selected");
    btn.setAttribute("aria-pressed", "true");
    selectedTime = time;
    
    // Show booking details
    bookingDetailsDiv.style.display = "block";
    bookingDateSpan.textContent = selectedDate;
    bookingTimeSpan.textContent = selectedTime;

    updatePayButtonState();
}

// Set minimum date to today
const today = new Date().toISOString().split('T')[0];
dateInput.min = today;

// Trigger when date changes
dateInput.addEventListener("change", () => {
    if (!dateInput.value) return;
    payBtn.disabled = true;
    bookingDetailsDiv.style.display = "none";
    generateTimeSlots(dateInput.value);
});

function updatePayButtonState() {
    const isFormValid =
        nameInput.value.trim().length > 0 &&
        emailInput.value.trim().length > 0 &&
        phoneInput.value.trim().length > 0;

    payBtn.disabled = !(isFormValid && selectedDate && selectedTime && stripe);
}

bookingForm.addEventListener("input", () => {
    if (formMessage) {
        formMessage.textContent = "";
    }
    updatePayButtonState();
});

// Payment button
payBtn.addEventListener("click", async () => {
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
    
    payBtn.disabled = true;
    payBtn.textContent = "Processing...";
    payBtn.setAttribute("aria-busy", "true");
    
    try {
        // Create payment intent
        const response = await fetch("/api/create-payment-intent", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                amount: total * 100, // Convert to cents
                date: selectedDate,
                time: selectedTime,
                services: cart,
                customer: {
                    name: nameInput.value.trim(),
                    email: emailInput.value.trim(),
                    phone: phoneInput.value.trim(),
                    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
                }
            })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            throw new Error(data.error || "Payment failed");
        }
        
        // Redirect to Stripe Checkout
        const result = await stripe.redirectToCheckout({
            sessionId: data.sessionId
        });
        
        if (result.error) {
            if (formMessage) {
                formMessage.textContent = `Payment error: ${result.error.message}`;
            }
            payBtn.disabled = false;
            payBtn.textContent = "Pay & Confirm Booking";
            payBtn.removeAttribute("aria-busy");
        }
    } catch (error) {
        console.error("Error:", error);
        if (formMessage) {
            formMessage.textContent = `Error: ${error.message}`;
        }
        payBtn.disabled = false;
        payBtn.textContent = "Pay & Confirm Booking";
        payBtn.removeAttribute("aria-busy");
    }
});

// Initialize
loadCart();
initStripe();
updatePayButtonState();
