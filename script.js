const form = document.querySelector("form");

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const data = {
    firstName: document.querySelector("#firstName").value,
    lastName: document.querySelector("#lastName").value,
    email: document.querySelector("#email").value,
    phone: document.querySelector("#phone").value,
    zip: document.querySelector("#zip").value,
    age: document.querySelector("#age").value,
    coverage: document.querySelector("#coverage").value,
    insurance: document.querySelector("#insurance").value,
    consent: true
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
    } else {
      alert(result.message);
    }
  } catch (error) {
    console.error(error);
    alert("Something went wrong. Please try again.");
  }
});
