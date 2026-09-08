// ==============================
// DETECT LEAD SOURCE
// ==============================

const urlParams = new URLSearchParams(window.location.search);
const rawSource = urlParams.get("utm_source");

let leadSource = "Direct/Unknown";

if (rawSource) {
  const normalizedSource = rawSource.toLowerCase();

  if (normalizedSource === "google") {
    leadSource = "Google";
  } else if (
    normalizedSource === "facebook" ||
    normalizedSource === "meta"
  ) {
    leadSource = "Facebook";
  } else if (normalizedSource === "instagram") {
    leadSource = "Instagram";
  } else if (normalizedSource === "tiktok") {
    leadSource = "TikTok";
  } else {
    leadSource =
      normalizedSource.charAt(0).toUpperCase() +
      normalizedSource.slice(1);
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
  leadSource,

pageUrl:
  window.location.href
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


      const responseText = await response.text();

      let result;

      try {
        result = JSON.parse(responseText);
      } catch {
        throw new Error(
          "The server returned an invalid response."
        );
      }


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
