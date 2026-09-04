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

  // Check required information
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

  // Consent is required
  if (consent !== true) {
    return res.status(400).json({
      success: false,
      message: "Consent is required."
    });
  }

  // For now, just confirm that the lead was received.
  // We will connect the database next.
  console.log("New SecureLife lead received:", {
    firstName,
    lastName,
    email,
    phone,
    zip,
    age,
    coverage,
    insurance
  });

  res.status(201).json({
    success: true,
    message: "Your information has been received."
  });
});

// Render requires the server to listen on the PORT environment variable
// and on 0.0.0.0.
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SecureLife backend running on port ${PORT}`);
});
