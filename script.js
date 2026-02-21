// All services categorized
const serviceData = {
    "facial-waxing": [
        { name: "Eyebrows", price: 18 },
        { name: "Upper Lip", price: 10 },
        { name: "Lower Lip", price: 10 },
        { name: "Chin", price: 12 },
        { name: "Full Face", price: 48 },
        { name: "Neck", price: 14 },
        { name: "Cheeks", price: 14 },
        { name: "Sideburns", price: 14 },
        { name: "Nose", price: 10 },
        { name: "Ears", price: 10 },
        { name: "Hairline", price: 12 }
    ],
    "full-body-waxing": [
        { name: "Full Arms", price: 45 },
        { name: "Half Arms", price: 38 },
        { name: "Full Legs", price: 75 },
        { name: "Lower Legs", price: 42 },
        { name: "Upper Legs", price: 45 },
        { name: "Underarms", price: 22 },
        { name: "Full Back", price: 60 },
        { name: "Upper Back", price: 25 },
        { name: "Mid Back", price: 25 },
        { name: "Lower Back", price: 20 },
        { name: "Chest Full", price: 30 },
        { name: "Chest Strip", price: 22 },
        { name: "Stomach Full", price: 35 },
        { name: "Stomach Strip", price: 8 },
        { name: "Hands", price: 14 },
        { name: "Knees", price: 15 },
        { name: "Toes", price: 12 }
    ],
    "intimate-waxing": [
        { name: "Bikini Brazilian (Specialty)", price: 58 },
        { name: "Bikini Full", price: 42 },
        { name: "Bikini Line", price: 43 },
        { name: "Inner Thigh", price: 8 },
        { name: "Full Butt", price: 25 },
        { name: "Butt Strip", price: 18 },
        { name: "Nipples", price: 12 }
    ],
    "corrective-facial": [
        { name: "Classic Corrective Facial", price: 85 },
        { name: "Advanced Treatment Facial", price: 110 },
        { name: "Back Facial", price: 80 },
        { name: "Vagacial Treatment", price: 70 }
    ],
    "enhancement-addons": [
        { name: "Dermaplaning", price: 50 },
        { name: "High Frequency Treatment", price: 20 },
        { name: "LED Light Therapy", price: 20 },
        { name: "Scalp Massage", price: 15 },
        { name: "Lash Lift & Tint", price: 70 },
        { name: "Lash Tint", price: 15 }
    ],
    "chemical-peels": [
        { name: "Red Carpet 4 Layer Peel", price: 120 },
        { name: "Lightening Lift Peel", price: 110 },
        { name: "Perfection Lift Peel", price: 110 },
        { name: "Acne Lift Peel", price: 110 }
    ]
};

// Cart
let cart = [];
let total = 0;
const cartMessage = document.getElementById("cart-message");

// Render Services
Object.keys(serviceData).forEach(categoryId => {
    const container = document.getElementById(categoryId);
    serviceData[categoryId].forEach(service => {
        const div = document.createElement("div");
        div.classList.add("service-item");
        div.innerHTML = `
            <span>${service.name} - $${service.price}</span>
            <button type="button">Add to Cart</button>
        `;
        const addButton = div.querySelector("button");
        addButton.setAttribute("aria-label", `Add ${service.name} to cart`);
        addButton.addEventListener("click", () => addToCart(service));
        container.appendChild(div);
    });
});


// Collapsible category headers
function toggleCategory(header, forceOpen = null) {
    const content = header.nextElementSibling;
    const isOpen = forceOpen !== null ? forceOpen : content.style.display === "block";
    const nextOpenState = forceOpen !== null ? forceOpen : !isOpen;

    content.style.display = nextOpenState ? "block" : "none";
    content.setAttribute("aria-hidden", String(!nextOpenState));
    header.classList.toggle("active", nextOpenState);
    header.setAttribute("aria-expanded", String(nextOpenState));
}

document.querySelectorAll(".category-header").forEach(header => {
    header.addEventListener("click", () => toggleCategory(header));
    header.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggleCategory(header);
        }
    });
});

// Navbar links scroll and open
document.querySelectorAll(".services-nav a").forEach(link => {
    link.addEventListener("click", e => {
        e.preventDefault();
        const targetId = link.dataset.target;
        const content = document.getElementById(targetId);
        const header = content.previousElementSibling;

        // Expand if collapsed
        if (content.style.display !== "block") {
            toggleCategory(header, true);
        }

        // Collapse other categories (accordion style)
        document.querySelectorAll(".service-category").forEach(cat => {
            if (cat !== content) {
                cat.style.display = "none";
                cat.setAttribute("aria-hidden", "true");
                cat.previousElementSibling.classList.remove("active");
                cat.previousElementSibling.setAttribute("aria-expanded", "false");
            }
        });

        // Scroll so that the category header is just below the navbar
        const navbarHeight = document.querySelector(".services-nav").offsetHeight;
        const headerTop = header.getBoundingClientRect().top + window.scrollY;
        window.scrollTo({
            top: headerTop - navbarHeight,
            behavior: "smooth"
        });
    });
});

// Add to Cart
function addToCart(service) {
    cart.push(service);
    total += service.price;
    document.getElementById("total").textContent = total;

    if (cartMessage) {
        cartMessage.textContent = "Added to cart.";
    }

    const li = document.createElement("li");
    li.textContent = `${service.name} - $${service.price}`;
    document.getElementById("cart-items").appendChild(li);
}

// Checkout — go to booking page
document.getElementById("checkout-btn").addEventListener("click", () => {
    if(cart.length === 0){
        if (cartMessage) {
            cartMessage.textContent = "Please add at least one service to cart.";
        }
        return;
    }
    // Save cart to localStorage for next page
    localStorage.setItem("cart", JSON.stringify(cart));
    localStorage.setItem("total", total);
    // Redirect to booking page
    window.location.href = "booking.html";
});
