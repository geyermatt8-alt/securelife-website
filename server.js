const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

app.use(cors());
app.use(express.json({ limit: "32kb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Create the leads table automatically
async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      zip TEXT NOT NULL,
      age TEXT NOT NULL,
      coverage TEXT NOT NULL,
      insurance TEXT NOT NULL,
      consent BOOLEAN NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Database connected and ready");
}

setupDatabase().catch((error) => {
  console.error("Database setup error:", error);
});
async function setupLeadManagement() {
  await pool.query(`
    ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New',
    ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS buyer TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0
  `);

  console.log("Lead management fields ready");
}

setupLeadManagement().catch((error) => {
  console.error("Lead management setup error:", error);
});
// Health check
app.get("/api/healthz", (req, res) => {
  res.json({
    status: "ok",
    message: "SecureLife backend is running"
  });
});

// Receive and save a life insurance lead
app.post("/api/leads", async (req, res) => {
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

  try {
    await pool.query(
      `
      INSERT INTO leads
      (first_name, last_name, email, phone, zip, age, coverage, insurance, consent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `,
      [
        firstName,
        lastName,
        email,
        phone,
        zip,
        age,
        coverage,
        insurance,
        consent
      ]
    );

    console.log("New SecureLife lead saved to database");

    res.status(201).json({
      success: true,
      message: "Your information has been received."
    });
  } catch (error) {
    console.error("Database error:", error);

    res.status(500).json({
      success: false,
      message: "Unable to save your information."
    });
  }
});
// View all saved leads - password protected
app.get("/api/leads", async (req, res) => {
  const password = req.headers["x-dashboard-password"];

  if (!password || password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  try {
    const result = await pool.query(
      "SELECT * FROM leads ORDER BY created_at DESC"
    );

    res.json({
      success: true,
      leads: result.rows
    });
  } catch (error) {
    console.error("Error retrieving leads:", error);

    res.status(500).json({
      success: false,
      message: "Unable to retrieve leads."
    });
  }
});
// Update a lead
app.put("/api/leads/:id", async (req, res) => {
  const password = req.headers["x-dashboard-password"];

  if (!password || password !== process.env.DASHBOARD_PASSWORD) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  const { id } = req.params;
  const { status, notes, buyer, price } = req.body;

  try {
    const result = await pool.query(
      `
      UPDATE leads
      SET status = $1,
          notes = $2,
          buyer = $3,
          price = $4
      WHERE id = $5
      RETURNING *
      `,
      [status, notes, buyer, price, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Lead not found."
      });
    }

    res.json({
      success: true,
      lead: result.rows[0]
    });
  } catch (error) {
    console.error("Error updating lead:", error);

    res.status(500).json({
      success: false,
      message: "Unable to update lead."
    });
  }
});
const PORT = process.env.PORT || 10000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`SecureLife backend running on port ${PORT}`);
});
