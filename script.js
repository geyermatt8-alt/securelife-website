// ==============================
// DETECT LEAD SOURCE
// ==============================

const urlParams = new URLSearchParams(window.location.search);

let leadSource = urlParams.get("utm_source") || "";

if (leadSource) {
  leadSource = leadSource.toLowerCase();

  if (leadSource === "google") {
    leadSource = "Google";
  } else if (
    leadSource === "facebook" ||
    leadSource === "meta"
  ) {
    leadSource = "Facebook";
  } else if (leadSource === "instagram") {
    leadSource = "Instagram";
  } else if (leadSource === "tiktok") {
    leadSource = "TikTok";
  } else {
    leadSource =
      leadSource.charAt(0).toUpperCase() +
      leadSource.slice(1);
  }
}


// ==============================
// FORM ELEMENTS
// ==============================

const form = document.querySelector("#quoteForm");

const submitButton =
  document.querySelector("#submitButton");

const formMessage =
  document.querySelector("#formMessage");


// ==============================
// AGE SLIDER
// ==============================

const ageSlider =
  document.querySelector("#age");

const ageValue =
  document.querySelector("#ageValue");


function updateAge() {
  ageValue.textContent = ageSlider.value;
}


ageSlider.addEventListener(
  "input",
  updateAge
);


updateAge();


// ==============================
// COVERAGE SLIDER
// ==============================

const coverageSlider =
  document.querySelector("#coverage");

const coverageValue =
  document.querySelector("#coverageValue");


function updateCoverage() {
  const amount =
    Number(coverageSlider.value);

  coverageValue.textContent =
    amount.toLocaleString("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    });
}


coverageSlider.addEventListener(
  "input",
  updateCoverage
);


updateCoverage();


// ==============================
// DISPLAY FORM MESSAGE
// ==============================

function showMessage(message, type) {
  formMessage.textContent = message;

  formMessage.className =
    `form-message ${type}`;
}


// ==============================
// FORM SUBMISSION
// ==============================

form.addEventListener(
  "submit",
  async (event) => {

    event.preventDefault();

    formMessage.textContent = "";
    formMessage.className = "form-message";

    submitButton.disabled = true;
    submitButton.textContent = "Submitting...";


    const data = {
      firstName:
        document
          .querySelector("#firstName")
          .value
          .trim(),

      lastName:
        document
          .querySelector("#lastName")
          .value
          .trim(),

      email:
        document
          .querySelector("#email")
          .value
          .trim(),

      phone:
        document
          .querySelector("#phone")
          .value
          .trim(),

      zip:
        document
          .querySelector("#zip")
          .value
          .trim(),

      age:
        ageSlider.value,

      coverage:
        coverageSlider.value,

      insurance:
        document
          .querySelector("#insurance")
          .value,

      consent:
        document
          .querySelector("#consent")
          .checked,

      source:
        leadSource
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


      if (!response.ok || !result.success) {
        throw new Error(
          result.message ||
          "Unable to submit your information."
        );
      }


      showMessage(
        "Thank you! Your information has been received.",
        "success"
      );


      form.reset();

      updateAge();
      updateCoverage();

    } catch (error) {

      console.error(
        "Form submission error:",
        error
      );


      showMessage(
        error.message ||
        "Something went wrong. Please try again.",
        "error"
      );

    } finally {

      submitButton.disabled = false;

      submitButton.textContent =
        "Get My Free Quote";

    }

  }
);
