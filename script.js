// Shared service data (single source of truth)
const sharedCatalog = window.luneliaServiceCatalog?.serviceData || {};
const uiServiceData = Object.fromEntries(
    Object.entries(sharedCatalog).map(([categoryId, category]) => [
        categoryId,
        Array.isArray(category?.services)
            ? category.services.map((service) => ({
                  id: service.id,
                  name: service.name,
                  price: service.price,
                  duration: service.duration
              }))
            : []
    ])
);

// Cart
let cart = [];
let total = 0;
const cartMessage = document.getElementById("cart-message");
const cartItemsList = document.getElementById("cart-items");
const totalElement = document.getElementById("total");

// Render Services
Object.keys(uiServiceData).forEach(categoryId => {
    const container = document.getElementById(categoryId);
    uiServiceData[categoryId].forEach(service => {
        const div = document.createElement("div");
        div.classList.add("service-item");
        div.innerHTML = `
            <span>${service.name} - $${service.price}</span>
            <button type="button">Add to Cart</button>
        `;
        const addButton = div.querySelector("button");
        const isCallToBook = categoryId === "chemical-peels";

        if (isCallToBook) {
            addButton.textContent = "Email us to book this service!";
            addButton.disabled = true;
            addButton.classList.add("call-to-book-btn");
            addButton.setAttribute("aria-label", `Email us to book ${service.name}`);
        } else {
            addButton.setAttribute("aria-label", `Add ${service.name} to cart`);
            addButton.addEventListener("click", () => addToCart(service));
        }
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

const bookNowLink = document.querySelector(".hero-book-link");
if (bookNowLink) {
    bookNowLink.addEventListener("click", (event) => {
        event.preventDefault();

        document.querySelectorAll(".category-header").forEach((header) => {
            toggleCategory(header, true);
        });

        const servicesSection = document.querySelector(".services");
        if (servicesSection) {
            const navbar = document.querySelector(".services-nav");
            const offset = navbar ? navbar.offsetHeight : 0;
            const targetTop = servicesSection.getBoundingClientRect().top + window.scrollY - offset;

            window.scrollTo({
                top: targetTop,
                behavior: "smooth"
            });
        }
    });
}

function renderHomeCart() {
    cartItemsList.innerHTML = "";

    cart.forEach((item, index) => {
        const li = document.createElement("li");

        const itemText = document.createElement("span");
        itemText.textContent = `${item.name} - $${item.price}`;

        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "cart-remove-btn";
        removeButton.textContent = "Remove";
        removeButton.setAttribute("aria-label", `Remove ${item.name} from cart`);
        removeButton.addEventListener("click", () => removeFromHomeCart(index));

        li.appendChild(itemText);
        li.appendChild(removeButton);
        cartItemsList.appendChild(li);
    });

    totalElement.textContent = String(total);
}

function removeFromHomeCart(index) {
    const [removedItem] = cart.splice(index, 1);
    if (!removedItem) {
        return;
    }

    total = Math.max(0, total - Number(removedItem.price || 0));
    renderHomeCart();

    if (cartMessage) {
        cartMessage.textContent = "Removed from cart.";
    }
}

// Add to Cart
function addToCart(service) {
    const serviceId = String(service?.id || "").trim();
    const duplicate = cart.some((item) => {
        const itemId = String(item?.id || "").trim();
        if (serviceId && itemId) {
            return itemId === serviceId;
        }

        return String(item?.name || "").trim().toLowerCase() ===
            String(service?.name || "").trim().toLowerCase();
    });

    if (duplicate) {
        if (cartMessage) {
            cartMessage.textContent = "This treatment is already in your cart.";
        }
        return;
    }

    cart.push(service);
    total += service.price;
    renderHomeCart();

    if (cartMessage) {
        cartMessage.textContent = "Added to cart.";
    }

    const cartSection = document.getElementById("home-cart");
    if (cartSection) {
        const navbar = document.querySelector(".services-nav");
        const offset = navbar ? navbar.offsetHeight : 0;
        const targetTop = cartSection.getBoundingClientRect().top + window.scrollY - offset;

        window.scrollTo({
            top: targetTop,
            behavior: "smooth"
        });
    }
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
