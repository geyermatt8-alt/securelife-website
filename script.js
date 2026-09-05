// Detect where the visitor came from
const urlParams = new URLSearchParams(window.location.search);

let leadSource = urlParams.get("utm_source") || "";

if (leadSource) {
  leadSource = leadSource.toLowerCase();

  if (leadSource === "google") {
    leadSource = "Google";
  } else if (leadSource === "facebook" || leadSource === "meta") {
    leadSource = "Facebook";
  } else if (leadSource === "instagram") {
    leadSource = "Instagram";
  } else if (leadSource === "tiktok") {
    leadSource = "TikTok";
  } else {
    leadSource =
      leadSource.charAt(0).toUpperCase() + leadSource.slice(1);
  }
}


// ==============================
// SLIDER ELEMENTS
// ==============================

const ageSlider = document.querySelector("#age");
const ageValue = document.querySelector("#ageValue");

const coverageSlider = document.querySelector("#coverage");
const coverageValue = document.querySelector("#coverageValue");

const insuranceSlider = document.querySelector("#insurance");
const insuranceValue = document.querySelector("#insuranceValue");


// ==============================
// AGE SLIDER
// ==============================

function updateAge() {
  ageValue.textContent = ageSlider.value;
}

ageSlider.addEventListener("input", updateAge);

updateAge();


// ==============================
// COVERAGE SLIDER
// ==============================

function updateCoverage() {
  const amount = Number(coverageSlider.value);

  coverageValue.textContent = amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

coverageSlider.addEventListener("input", updateCoverage);

updateCoverage();


// ==============================
// INSURANCE SLIDER
// ==============================

function updateInsurance() {
  const value = Number(insuranceSlider.value);

  if (value === 0) {
    insuranceValue.textContent = "No";
  } else if (value === 1) {
    insuranceValue.textContent = "Not Sure";
  } else {
    insuranceValue.textContent = "Yes";
  }
}

insuranceSlider.addEventListener("input", updateInsurance);

updateInsurance();


// ==============================
// FORM SUBMISSION
// ==============================

const form = document.querySelector("form");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  let insuranceAnswer = "";

  if (Number(insuranceSlider.value) === 0) {
    insuranceAnswer = "no";
  } else if (Number(insuranceSlider.value) === 1) {
    insuranceAnswer = "not-sure";
  } else {
    insuranceAnswer = "yes";
  }

  const data = {
    firstName: document.querySelector("#firstName").value,
    lastName: document.querySelector("#lastName").value,
    email: document.querySelector("#email").value,
    phone: document.querySelector("#phone").value,
    zip: document.querySelector("#zip").value,

    age: ageSlider.value,

    coverage: coverageSlider.value,

    insurance: insuranceAnswer,

    consent: document.querySelector("#consent").checked,

    source: leadSource
  };


  try {
    const response = await fetch(
      "https://securelife-backend-0ukl.onrender.com/api/leads",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json"
        },

        body: JSON.stringify(data)
      }
    );


    const result = await response.json();


    if (result.success) {

      alert("Thank you! Your information has been received.");

      form.reset();

      // Reset slider displays after form submission
      updateAge();
      updateCoverage();
      updateInsurance();

    } else {

      alert(result.message);

    }

  } catch (error) {

    console.error(error);

    alert("Something went wrong. Please try again.");

  }
});
