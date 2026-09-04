const express = require("express");

const app = express();

app.use(express.json({ limit: "32kb" }));

// Health check
app.get("/api/healthz", (req, res) => {
  res.json({
    status: "ok",
    message: "SecureLife backend is running"
  });
});

// Receive a life insurance lead
app.post("/api/leads", (req, res) => {
  const {
    firstName,
    lastName,
    email,
    phone,
    zip,
    age,
    coverage,
    insurance,
    consent
  } = req.body;

  if (
    !firstName ||
    !lastName ||
    !email ||
    !phone ||
    !zip ||
    !age ||
    !coverage ||
    !insurance
  ) {
    return res.status(400).json({
      success: false,
      message: "Please complete all required fields."
    });
  }

  if (consent !== true) {
    return res.status(400).json({
      success: false,
      message: "Consent is required."
    });
  }

  console.log("New SecureLife lead received");

  res.status(201).json({
    success: true,
    message: "Your information has been received."
  });
});

const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SecureLife backend running on port ${PORT}`);
});
