// Service data with durations (in minutes) and prices
// Duration = service time + buffer, already included
const serviceData = {
    "facial-waxing": {
        name: "Facial Waxing",
        badge: null,
        services: [
            { id: "brows", name: "Eyebrows", price: 18, duration: 15, description: "" },
            { id: "upper-lip", name: "Upper Lip", price: 10, duration: 10, description: "" },
            { id: "lower-lip", name: "Lower Lip", price: 10, duration: 10, description: "" },
            { id: "chin", name: "Chin", price: 12, duration: 10, description: "" },
            { id: "full-face", name: "Full Face", price: 48, duration: 30, description: "" },
            { id: "neck", name: "Neck", price: 14, duration: 10, description: "" },
            { id: "cheeks", name: "Cheeks", price: 14, duration: 10, description: "" },
            { id: "sideburns", name: "Sideburns", price: 14, duration: 10, description: "" },
            { id: "nose", name: "Nose", price: 10, duration: 10, description: "" },
            { id: "ears", name: "Ears", price: 10, duration: 10, description: "" },
            { id: "hairline", name: "Hairline", price: 12, duration: 15, description: "" }
        ]
    },
    "full-body-waxing": {
        name: "Full Body Waxing",
        badge: null,
        services: [
            { id: "full-arms", name: "Full Arms", price: 45, duration: 35, description: "" },
            { id: "half-arms", name: "Half Arms", price: 38, duration: 25, description: "" },
            { id: "full-legs", name: "Full Legs", price: 75, duration: 50, description: "" },
            { id: "lower-legs", name: "Lower Legs", price: 42, duration: 30, description: "" },
            { id: "upper-legs", name: "Upper Legs", price: 45, duration: 35, description: "" },
            { id: "underarms", name: "Underarms", price: 22, duration: 15, description: "" },
            { id: "full-back", name: "Full Back", price: 60, duration: 40, description: "" },
            { id: "upper-back", name: "Upper Back", price: 25, duration: 25, description: "" },
            { id: "mid-back", name: "Mid Back", price: 25, duration: 25, description: "" },
            { id: "lower-back", name: "Lower Back", price: 20, duration: 22, description: "" },
            { id: "chest-full", name: "Chest Full", price: 30, duration: 30, description: "" },
            { id: "chest-strip", name: "Chest Strip", price: 22, duration: 13, description: "" },
            { id: "stomach-full", name: "Stomach Full", price: 35, duration: 25, description: "" },
            { id: "stomach-strip", name: "Stomach Strip", price: 8, duration: 12, description: "" },
            { id: "hands", name: "Hands", price: 14, duration: 13, description: "" },
            { id: "knees", name: "Knees", price: 15, duration: 13, description: "" },
            { id: "toes", name: "Toes", price: 12, duration: 13, description: "" }
        ]
    },
    "intimate-waxing": {
        name: "Intimate Waxing Services",
        badge: null,
        services: [
            { id: "brazilian", name: "Brazilian (Specialty)", price: 33, duration: 30, description: "", badge: "Specialty" },
            { id: "bikini-full", name: "Bikini Full", price: 48, duration: 25, description: "" },
            { id: "bikini-line-v", name: "Bikini Line (V)", price: 20, duration: 20, description: "" },
            { id: "bikini-line-f", name: "Bikini Line (F)", price: 20, duration: 20, description: "" },
            { id: "inner-thigh", name: "Inner Thigh", price: 8, duration: 13, description: "" },
            { id: "full-butt", name: "Full Butt", price: 25, duration: 25, description: "" },
            { id: "butt-strip", name: "Butt Strip", price: 18, duration: 13, description: "" },
            { id: "nipples", name: "Nipples", price: 12, duration: 10, description: "" }
        ]
    },
    "corrective-facial": {
        name: "Corrective Facial Services",
        badge: "Master Esthetician Specialty",
        services: [
            { id: "classic-facial", name: "Classic Corrective Facial", price: 85, duration: 75, description: "" },
            { id: "advanced-facial", name: "Advanced Treatment Facial", price: 110, duration: 90, description: "" },
            { id: "back-facial", name: "Back Facial", price: 80, duration: 60, description: "" },
            { id: "vagacial", name: "Vagacial Treatment", price: 70, duration: 60, description: "" }
        ]
    },
    "enhancement-addons": {
        name: "Enhancement Add-Ons",
        badge: null,
        services: [
            { id: "dermaplaning", name: "Dermaplaning (Specialty)", price: 50, duration: 0, description: "Included in facial block", badge: "Specialty" },
            { id: "high-frequency", name: "High Frequency Treatment", price: 20, duration: 0, description: "Included in facial block" },
            { id: "led-therapy", name: "LED Light Therapy", price: 20, duration: 0, description: "Included in facial block" },
            { id: "scalp-massage", name: "Scalp Massage", price: 15, duration: 0, description: "Included in facial block" },
            { id: "lash-lift-tint", name: "Lash Lift & Tint", price: 70, duration: 75, description: "Standalone appointment" },
            { id: "lash-tint", name: "Lash Tint", price: 15, duration: 25, description: "Standalone appointment" }
        ]
    },
    "chemical-peels": {
        name: "Signature Chemical Peels",
        badge: "Image Skincare Certified",
        services: [
            { id: "red-carpet", name: "Red Carpet 4 Layer Peel", price: 120, duration: 75, description: "New to peels? A Classic Corrective Facial is required before your first peel appointment.", prerequisite: "classic-facial" },
            { id: "lightening-lift", name: "Lightening Lift Peel", price: 110, duration: 75, description: "New to peels? A Classic Corrective Facial is required before your first peel appointment.", prerequisite: "classic-facial" },
            { id: "perfection-lift", name: "Perfection Lift Peel", price: 110, duration: 75, description: "New to peels? A Classic Corrective Facial is required before your first peel appointment.", prerequisite: "classic-facial" },
            { id: "acne-lift", name: "Acne Lift Peel", price: 110, duration: 75, description: "New to peels? A Classic Corrective Facial is required before your first peel appointment.", prerequisite: "classic-facial" }
        ]
    }
};

// Combo stacking rules
const comboStackingRules = {
    sameArea: { addMinutes: 3 },        // Same position, no repositioning
    adjacent: { addMinutes: 5 },       // Minor transition/repositioning
    separate: "fullBlock",             // Separate setup — use full block time
    facialAddon: { addMinutes: 0 },    // Enhancement add-ons absorbed
    faceCombo: { addMinutes: 3 }       // Additional facial areas
};

function toDurationBucket(duration) {
    const minutes = Number(duration);

    if (!Number.isFinite(minutes) || minutes <= 15) return 15;
    if (minutes <= 30) return 30;
    if (minutes <= 45) return 45;
    if (minutes <= 60) return 60;
    return 75;
}

for (const category of Object.values(serviceData)) {
    if (!category || !Array.isArray(category.services)) {
        continue;
    }

    for (const service of category.services) {
        service.duration = toDurationBucket(service.duration);
    }
}

// Helper: calculate total time for a combo
function calculateComboTime(serviceIds) {
    if (!serviceIds || serviceIds.length === 0) return 0;
    return serviceIds.reduce((sum, serviceId) => {
        const service = findServiceById(serviceId);
        return sum + (service ? service.duration : 0);
    }, 0);
}

// Helper: find a service by ID
function findServiceById(serviceId) {
    for (const category of Object.values(serviceData)) {
        const found = category.services.find(s => s.id === serviceId);
        if (found) return found;
    }
    return null;
}

// Helper: get all services as flat array
function getAllServices() {
    const all = [];
    for (const category of Object.values(serviceData)) {
        all.push(...category.services);
    }
    return all;
}

const exportedCatalog = {
    serviceData,
    comboStackingRules,
    calculateComboTime,
    findServiceById,
    getAllServices
};

if (typeof module !== "undefined" && module.exports) {
    module.exports = exportedCatalog;
}

if (typeof window !== "undefined") {
    window.luneliaServiceCatalog = exportedCatalog;
}
