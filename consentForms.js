const { serviceData } = require("./serviceData");

// Months a signed consent form stays valid before the client must sign it again.
const CONSENT_VALIDITY_MONTHS = 12;

const YES_NO = ["Yes", "No"];
const yesNo = (id, label, extra = {}) => ({ type: "single", id, label, options: YES_NO, required: true, ...extra });
const text = (id, label, extra = {}) => ({ type: "text", id, label, required: true, ...extra });
const multi = (id, label, options, extra = {}) => ({ type: "multi", id, label, options, required: true, ...extra });
const agree = (id, label, extra = {}) => ({ type: "agree", id, label, required: true, ...extra });
const info = (heading, paragraphs = [], list = []) => ({ type: "info", heading, paragraphs, list });

// Item types: info (display only), text, single (radio), multi (checkboxes), agree (one checkbox).
// showIf: { field, equals } or { field, includes } hides an item until the earlier answer matches.
// Bump a form's version when its wording changes materially.
const CONSENT_FORMS = {
    facial: {
        title: "Facial Intake & Consent Form",
        version: "1",
        items: [
            text("age", "Age", { inputType: "number" }),
            info("Before and After Photo Consent (Optional)", [
                "Your consent is entirely optional. If provided, photos may be used for marketing purposes, social media, or our professional portfolio. You may opt out at any time."
            ]),
            agree("photo-consent", "I give consent for before and after photos.", { required: false }),
            yesNo("facial-before", "Have you had a facial before?"),
            multi("skincare-concerns", "What are your specific skincare concerns?", [
                "Dry Flakey Skin", "Breakouts", "Wrinkles", "Blackheads", "Acne*", "Loss of Firmness",
                "Clogged Pores", "Skin Texture", "Large Pores", "Hyper-Pigmentation / Uneven Skin Tone",
                "Redness", "Skin Sensitivity", "Rosacea", "Oily Skin", "Milia", "Fine Lines", "Other"
            ]),
            text("skincare-concerns-other", "Other skincare concerns (please specify)", {
                multiline: true,
                showIf: { field: "skincare-concerns", includes: "Other" }
            }),
            {
                type: "single",
                id: "acne-acknowledgement",
                label: "*If you have acne: I understand corrective facials will only help clear out congestion and some current blemishes. It will not prevent future congestion or blemishes. If you need help clearing acne, we have an acne program and can schedule you for an acne clearing program first time consultation at a later date.",
                options: ["I understand", "Not applicable"],
                required: true
            },
            {
                type: "single",
                id: "facial-reason",
                label: "Any other reasons for a facial besides your concerns?",
                options: ["Relaxation", "Skincare Education", "Help with What is Best for My Skin"],
                required: true
            },
            multi("daily-products", "Give us an idea of what you typically use on your skin daily?", [
                "Soap", "Cleanser", "Toner", "Serum", "Mask", "Exfoliant (physical or chemical)",
                "Eye Cream", "Moisturizer", "SPF", "Vitamin A (retinol)"
            ]),
            multi("allergies", "Any known allergies?", [
                "Aspirin", "Latex", "Fruits", "Shellfish", "Lidocaine", "Fragrance/Essential oils",
                "Tree Nuts", "Dairy", "Sunscreen", "Pollen", "None", "Other"
            ]),
            text("allergies-other", "Other allergies (please specify)", {
                multiline: true,
                showIf: { field: "allergies", includes: "Other" }
            }),
            yesNo("skin-conditions", "Have you ever been diagnosed with eczema, psoriasis or rosacea on the face?"),
            multi("current-products", "Are you currently using any products that contain:", [
                "AHA (glycolic acid, lactic acid, etc.)", "BHA (salicylic acid)",
                "Vitamin A derivative (retinol/retinoids)", "Exfoliating scrubs", "Prescription Topicals"
            ], { required: false }),
            text("face-rashes", "Do you currently have any rashes, itching or underlying redness on your face?", { multiline: true }),
            text("medications", "Please list medications or supplements you are currently taking.", { multiline: true }),
            {
                type: "single",
                id: "recent-treatments",
                label: "Have you ever received chemical peels, laser services, or microdermabrasion treatments?",
                options: ["YES, within the last month", "YES, within the last 2-3 months", "NO"],
                required: true
            },
            yesNo("botox", "Have you had botox in the past 7 days?"),
            yesNo("fillers", "Have you had fillers in the past 14 days?"),
            multi("medical-history", "Your Medical History: Have you experienced any of these health conditions in the past or present?", [
                "Hormone Imbalance", "Cancer/ Systemic disease", "High Blood Pressure", "Diabetes",
                "Heart problem", "Arthritis", "Auto-immune Disorder", "Asthma", "Epilepsy/Seizures",
                "Cold sores", "HIV/AIDS", "Lupus", "Depression/Anxiety", "Headaches/ Migraines", "None", "Other"
            ]),
            text("medical-history-other", "Other health conditions (please specify)", {
                multiline: true,
                showIf: { field: "medical-history", includes: "Other" }
            }),
            info("Female Clients"),
            yesNo("birth-control", "Are you taking birth control?", { required: false }),
            yesNo("pregnant", "Are you pregnant or breast-feeding?", { required: false }),
            info("Post-care Agreement", ["To ensure the best results and the safety of your skin, please follow these post-care instructions:"]),
            info("General Instructions", [], [
                "Apply daily SPF.",
                "Do not pick or peel any flaking skin.",
                "If you experience any adverse reaction, contact Lunelia Esthetics LLC immediately."
            ]),
            info("Exfoliation & Waxing Guidelines", [], [
                "Regular Facial: Avoid retinoids, exfoliants, and waxing for at least 3 days.",
                "Chemical Peel & Dermaplane: Avoid retinoids, exfoliants, and waxing for at least 7 days."
            ]),
            info("Service-Specific Risks", [
                "Chemical Peel Risks: Redness, peeling, flaking, stinging, temporary darkening, hyperpigmentation, hypopigmentation, cold sore flare-ups, and in rare cases, scarring.",
                "Regular Facial Risks: Mild redness or sensitivity may occur. Keep skin hydrated and avoid harsh products.",
                "Dermaplane Facial Risks: Nicks, irritation, and potential breakouts."
            ]),
            agree("postcare-agreement", "I agree to these post-care instructions."),
            info("Acknowledgement and Waiver", [
                "I hereby agree to have this treatment be performed on me. I am aware that even with natural ingredients there is a remote chance of an allergic reaction and there is a possibility of an adverse reaction to product used in facials.",
                "I am also aware that certain services should not be performed with certain medical conditions. I have disclosed all my known medical conditions, allergies, medications and answered all questions honestly on the above form and agree to update Lunelia Esthetics LLC as to any changes.",
                "I acknowledge that the esthetician and staff at Lunelia Esthetics LLC do not provide medical advice and I accept full responsibility to seek out such advice before receiving any services or products from Lunelia Esthetics LLC. I hereby release, discharge and waive any and all claims against Lunelia Esthetics LLC and each of their partners, employees, representatives or any person(s) performing services or applying any products at Lunelia Esthetics LLC, including from liability and responsibility for any and all illness, injuries, damages, claims, rights and causes of action of any kind or nature, that may occur during or arising out of any services or products received on this and any future dates. I expressly assume and accept the risk for any injuries sustained. I have read this entire document and agree to its terms."
            ])
        ]
    },
    waxing: {
        title: "Waxing Intake and Consent Form",
        version: "1",
        items: [
            text("age", "Age", { inputType: "number" }),
            multi("hair-removal-methods", "Hair removal methods utilized recently and in the past?", [
                "Shaving", "Waxing", "Laser", "Sugaring", "None", "Other"
            ]),
            text("hair-removal-other", "Other hair removal methods (please specify)", {
                showIf: { field: "hair-removal-methods", includes: "Other" }
            }),
            text("acne-medications", "Have you taken Retin-A, Renova, Accutane, antibiotics, or any other acne or health-related medications in the last year? If yes, please list them and when you last used them.", { multiline: true }),
            yesNo("thinning-products", "Do you use any other skin-thinning products or blood-thinning medications?"),
            yesNo("tanning", "Do you regularly use tanning beds and/or expose yourself to the sun?", { required: false }),
            yesNo("open-lesions", "Are there any open skin lesions on your body?"),
            yesNo("ingrown-hairs", "Are ingrown hairs a problem for you?"),
            yesNo("cancer-treatment", "Have you had cancer treatment? If so, when and which therapies were used?"),
            text("cancer-treatment-details", "Cancer treatment details (when and which therapies)", {
                multiline: true,
                showIf: { field: "cancer-treatment", equals: "Yes" }
            }),
            yesNo("allergies", "Do you suffer from any allergies? If yes, please provide a list."),
            text("allergies-list", "Allergy list", {
                multiline: true,
                showIf: { field: "allergies", equals: "Yes" }
            }),
            info("Consent and Agreement", [
                "Please be aware that waxing might cause redness, swelling, soreness, skin lifting or tearing, bruising, burns, ingrown hairs, folliculitis, hyperpigmentation, allergic reaction, or infection. By signing this form, I acknowledge that I have read the preceding material and have answered the questions truthfully. I give permission to undertake the waxing technique we discussed and I release and hold harmless Lunelia Esthetics LLC from liability for reactions resulting from waxing services, including those caused by information I failed to disclose. I agree to follow all post-waxing safety precautions, including no peels, tanning, exfoliation, or wet room services; no swimming, spas, or hot tubs for 24 hours; and any home skin care procedures as indicated by my service provider. I understand that Lunelia Esthetics LLC and its provider will take all reasonable steps to minimize or eliminate any undesirable reactions. I also understand that Lunelia Esthetics LLC and its provider reserve the right to refuse service if a contraindication or safety concern is identified.",
                "This form is valid for 12 months or until your health status changes."
            ]),
            info("Before and After Photo Consent (Optional)", [
                "Your consent is entirely optional. If provided, photos may be used for marketing purposes, social media, or our professional portfolio. You may opt out at any time."
            ]),
            agree("photo-consent", "I consent to have before and after photos taken of my services.", { required: false }),
            info("Terms and Conditions Agreement"),
            agree("terms", "I agree to the terms and conditions")
        ]
    },
    "lash-tint": {
        title: "Eyelash Lift & Tint Consent Form",
        version: "1",
        items: [
            text("age", "Age", { inputType: "number" }),
            yesNo("lash-lift-before", "Have you ever had an eyelash lift/tint in the past?"),
            text("lash-lift-when", "If so, when?", { showIf: { field: "lash-lift-before", equals: "Yes" } }),
            yesNo("used-tint", "Have you ever used hair color/eyelash tint?"),
            yesNo("tint-reaction", "Have you ever had an allergic reaction to hair color/eyelash tint?"),
            yesNo("contacts", "Do you wear contact lenses?"),
            yesNo("eye-drops", "Are you currently using eye drops of any kind, prescription or over-the-counter?"),
            yesNo("eye-infections", "Do you have a history of recurrent eye or tear duct infections?"),
            yesNo("dry-eyes", "Do you have a history of dry eyes?"),
            text("allergies", "List any allergies you have:", { multiline: true }),
            text("conditions", "List any illness, medical condition, or medical treatment you are being treated by a physician for:", { multiline: true }),
            text("medications", "List any medications or supplements you are currently taking", { multiline: true }),
            info("Acknowledgements", [
                "Although every precaution will be taken to ensure your safety and well-being before, during, and after your eyelash lift/tint, please be aware of the following information and possible risks. Please check all boxes to acknowledge:"
            ]),
            agree("ack-risks", "I understand that there are risks associated with having an eyelash lift or tint."),
            agree("ack-irritation", "I understand that as part of the eyelash lift procedure, eye irritation, eye pain, eye itching, discomfort, and in rare cases, eye infection or blurred vision could occur."),
            agree("ack-contact-technician", "I agree that if I experience any of these conditions with my eyelashes or eyes, that I will contact my technician; if I choose to consult a physician, it will be at my own expense."),
            agree("ack-products", "I understand that instruments, tapes, cleansers, eye gel pads, adhesives, and/or removers may irritate my eyes or require a physician's follow up care, even though my technician utilized correct techniques and followed proper safety protocols."),
            agree("ack-staining", "I understand that there may be some residual dark staining left on the skin following the tinting process of my lashes. This will fade and go away within a short time."),
            agree("ack-color", "I understand that, while every attempt will be made to provide me with my chosen color, everyone's hair absorbs color differently and my final results may not be the color I initially wanted."),
            agree("ack-retint", "I understand that over the course of several weeks, the tint will gradually lighten and fade. Re-tinting will be required to keep the new color fresh. Most clients need to re-tint every 3 to 4 weeks."),
            agree("ack-lift", "I understand that an eyelash lift will lift my natural eyelashes. Depending on my natural eyelash length and strength, results may vary."),
            agree("ack-aftercare", "I understand and agree to the care instructions provided by my technician for the use and care of my natural eyelashes after the lift/tint. I realize and accept that the consequences of failure to adhere to these instructions may cause the eyelashes to not stay as lifted as long as originally told."),
            agree("ack-eyes-covered", "I understand and consent to having my eyes closed and covered for the entire duration of the procedure."),
            info("Aftercare Instructions"),
            info("Lash Lift Aftercare", [], [
                "Be gentle with your lashes; no rubbing or pulling.",
                "Do not get your lashes wet for the first 24 hours.",
                "Use of sauna/steam is possible after 24 hours, but may weaken the effect of the lift.",
                "Swimming should be avoided for at least 24 hours."
            ]),
            info("Lash Tint Aftercare", [], [
                "Do not use harsh products on your eyes or lashes.",
                "Avoid oil-based makeup and cleansers, and waterproof mascara."
            ]),
            info("Agreement", [
                "This agreement will remain in effect for this procedure and future procedures conducted by my technician. I have read the above information. If I have any concerns, I will address these with my esthetician. I give Lunelia Esthetics LLC permission to perform the eyelash lifting and tinting procedure we have discussed and will hold them or associates harmless from liability that may result from this treatment. I have accurately answered the questions above, including all known allergies, prescription drugs, or products I am currently using. I understand my esthetician will take every precaution to minimize or eliminate negative reactions as much as possible. In the event I may have additional questions or concerns regarding my treatment, I will consult my esthetician immediately. I agree about this constitutes full disclosure, and that it supersedes any previous verbal or written disclosures. I certify that I have read, and fully understand, the above paragraphs and that I have had sufficient opportunity for discussion to have any questions answered. I understand the procedure and accept the risks. I do not hold, Lunelia Esthetics LLC, or known associates responsible for any of my conditions that were present, but not disclosed at the time of the procedure that may be affected by the treatment performed today. By signing below, I verify that I have read and understand the above statements and agree with them."
            ]),
            info("Optional: Photo & Media Consent"),
            yesNo(
                "media-consent",
                "I consent to have my photos or videos taken for use in promotional or social media materials. (This is optional and will not affect the service provided to you.)",
                { required: false }
            )
        ]
    }
};

const CATEGORY_FORM_TYPES = {
    "facial-waxing": "waxing",
    "full-body-waxing": "waxing",
    "intimate-waxing": "waxing",
    "corrective-facial": "facial",
    "chemical-peels": "facial",
    "enhancement-addons": "facial"
};

const SERVICE_FORM_TYPE_OVERRIDES = {
    "lash-tint": "lash-tint",
    "brow-tint": "lash-tint"
};

const formTypeByServiceId = new Map();
for (const [categoryKey, category] of Object.entries(serviceData || {})) {
    for (const service of category?.services || []) {
        const formType = SERVICE_FORM_TYPE_OVERRIDES[service.id] || CATEGORY_FORM_TYPES[categoryKey];
        if (formType) {
            formTypeByServiceId.set(service.id, formType);
        }
    }
}

function getRequiredConsentTypes(serviceIds) {
    const types = new Set();
    for (const id of serviceIds || []) {
        const type = formTypeByServiceId.get(String(id));
        if (type) {
            types.add(type);
        }
    }
    return Array.from(types);
}

function isItemVisible(item, answers) {
    if (!item.showIf) {
        return true;
    }

    const value = answers[item.showIf.field];
    if (item.showIf.includes !== undefined) {
        return Array.isArray(value) && value.includes(item.showIf.includes);
    }
    return value === item.showIf.equals;
}

// Returns { answers } with only known, visible fields, or { error } for the first problem found.
function validateConsentAnswers(type, rawAnswers) {
    const form = CONSENT_FORMS[type];
    const raw = rawAnswers && typeof rawAnswers === "object" ? rawAnswers : {};
    const answers = {};

    for (const item of form.items) {
        if (item.type === "info" || !isItemVisible(item, answers)) {
            continue;
        }

        const fail = () => ({ error: `Please complete: ${item.label} (${form.title})` });
        const value = raw[item.id];

        if (item.type === "text") {
            const textValue = typeof value === "string" ? value.trim() : "";
            if (item.inputType === "number") {
                const age = Number(textValue);
                if (!Number.isInteger(age) || age < 1 || age > 120) {
                    return fail();
                }
                answers[item.id] = String(age);
                continue;
            }
            if (textValue.length > 1000) {
                return { error: `Answer is too long: ${item.label} (${form.title})` };
            }
            if (item.required && !textValue) {
                return fail();
            }
            answers[item.id] = textValue;
        } else if (item.type === "single") {
            if (value === undefined || value === null || value === "") {
                if (item.required) {
                    return fail();
                }
                answers[item.id] = "";
            } else if (!item.options.includes(value)) {
                return fail();
            } else {
                answers[item.id] = value;
            }
        } else if (item.type === "multi") {
            const picked = Array.isArray(value) ? value : [];
            if (!picked.every((option) => item.options.includes(option))) {
                return fail();
            }
            const unique = Array.from(new Set(picked));
            if (item.required && unique.length === 0) {
                return fail();
            }
            answers[item.id] = unique;
        } else if (item.type === "agree") {
            if (item.required && value !== true) {
                return fail();
            }
            answers[item.id] = value === true;
        }
    }

    return { answers };
}

function escapeHtml(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

// Full form text plus the client's answers, for the owner's records.
function renderConsentFormEmailHtml(type, submission) {
    const form = CONSENT_FORMS[type];
    const answers = submission.answers || {};
    const signedAt = new Date(submission.signedAt || Date.now()).toLocaleString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/New_York",
        timeZoneName: "short"
    });

    const body = form.items
        .filter((item) => item.type === "info" || isItemVisible(item, answers))
        .map((item) => {
            if (item.type === "info") {
                return [
                    item.heading ? `<h3>${escapeHtml(item.heading)}</h3>` : "",
                    ...(item.paragraphs || []).map((p) => `<p>${escapeHtml(p)}</p>`),
                    item.list?.length ? `<ul>${item.list.map((li) => `<li>${escapeHtml(li)}</li>`).join("")}</ul>` : ""
                ].join("");
            }

            const value = answers[item.id];
            if (item.type === "agree") {
                return `<p>${value ? "&#9745; Agreed" : "&#9744; Not selected"} &mdash; ${escapeHtml(item.label)}</p>`;
            }

            const display = Array.isArray(value) ? value.join(", ") : value;
            return `<p><strong>${escapeHtml(item.label)}</strong><br>${display ? escapeHtml(display) : "<em>No answer</em>"}</p>`;
        })
        .join("");

    return `
        <h2>${escapeHtml(form.title)}</h2>
        <p><strong>Name:</strong> ${escapeHtml(submission.name)}</p>
        <p><strong>Email:</strong> ${escapeHtml(submission.email)}</p>
        <p><strong>Phone:</strong> ${escapeHtml(submission.phone || "-")}</p>
        <p><strong>Signed:</strong> ${escapeHtml(signedAt)}</p>
        <p><strong>Form version:</strong> ${escapeHtml(form.version)}</p>
        <hr>
        ${body}
        <hr>
        <p><strong>Electronic Signature:</strong> ${escapeHtml(submission.signature)}</p>
        <p>By typing the name above, the client acknowledged that this electronic signature is as legally binding as a handwritten signature.</p>
    `;
}

module.exports = {
    CONSENT_FORMS,
    CONSENT_VALIDITY_MONTHS,
    getRequiredConsentTypes,
    validateConsentAnswers,
    renderConsentFormEmailHtml
};
