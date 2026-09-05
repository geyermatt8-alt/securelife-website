const express = require("express");
const { Resend } = require("resend");
const cors = require("cors");
const { Pool } = require("pg");

const app = express();

const resend = new Resend(process.env.RESEND_API_KEY);

app.use(cors());
app.use(express.json({ limit: "32kb" }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});


// ===============================
// DATABASE SETUP
// ===============================

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


// ===============================
// LEAD MANAGEMENT FIELDS
// ===============================

async function setupLeadManagement() {

  await pool.query(`
    ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New',
    ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS buyer TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT ''
  `);

  console.log("Lead management fields ready");
}


setupLeadManagement().catch((error) => {
  console.error("Lead management error:", error);
});


// ===============================
// BUYERS TABLE
// ===============================

async function setupBuyers() {

  await pool.query(`
    CREATE TABLE IF NOT EXISTS buyers (
      id SERIAL PRIMARY KEY,
      agency_name TEXT NOT NULL,
      contact_name TEXT DEFAULT '',
      email TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log("Buyers table ready");
}


setupBuyers().catch((error) => {
  console.error("Buyers setup error:", error);
});


// ===============================
// HEALTH CHECK
// ===============================

app.get("/api/healthz", (req, res) => {

  res.json({
    status: "ok",
    message: "SecureLife backend is running"
  });

});


// ===============================
// RECEIVE LEAD
// ===============================

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
    consent,
    source
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
      (
        first_name,
        last_name,
        email,
        phone,
        zip,
        age,
        coverage,
        insurance,
        consent,
        source
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
        consent,
        source || ""
      ]
    );


    console.log("New SecureLife lead saved to database");


    res.status(201).json({
      success: true,
      message: "Your information has been received."
    });

  }


  catch (error) {

    console.error("Database error:", error);


    res.status(500).json({
      success: false,
      message: "Unable to save your information."
    });

  }

});


// ===============================
// GET ALL LEADS
// ===============================

app.get("/api/leads", async (req, res) => {

  const password =
    req.headers["x-dashboard-password"];


  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }


  try {

    const result =
      await pool.query(
        "SELECT * FROM leads ORDER BY created_at DESC"
      );


    res.json({
      success: true,
      leads: result.rows
    });

  }


  catch (error) {

    console.error(
      "Error retrieving leads:",
      error
    );


    res.status(500).json({
      success: false,
      message: "Unable to retrieve leads."
    });

  }

});


// ===============================
// UPDATE LEAD
// ===============================

app.put("/api/leads/:id", async (req, res) => {

  const password =
    req.headers["x-dashboard-password"];


  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }


  const { id } = req.params;


  const {
    status,
    notes,
    buyer,
    price,
    source
  } = req.body;


  try {

    const result =
      await pool.query(
        `
        UPDATE leads
        SET
          status = $1,
          notes = $2,
          buyer = $3,
          price = $4,
          source = $5
        WHERE id = $6
        RETURNING *
        `,
        [
          status,
          notes,
          buyer,
          price,
          source || "",
          id
        ]
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

  }


  catch (error) {

    console.error(
      "Error updating lead:",
      error
    );


    res.status(500).json({
      success: false,
      message: "Unable to update lead."
    });

  }

});


// ===============================
// DELETE LEAD
// ===============================

app.delete("/api/leads/:id", async (req, res) => {

  const password =
    req.headers["x-dashboard-password"];


  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }


  const { id } = req.params;


  try {

    const result =
      await pool.query(
        "DELETE FROM leads WHERE id = $1 RETURNING *",
        [id]
      );


    if (result.rows.length === 0) {

      return res.status(404).json({
        success: false,
        message: "Lead not found."
      });

    }


    res.json({
      success: true,
      message: "Lead deleted successfully."
    });

  }


  catch (error) {

    console.error(
      "Error deleting lead:",
      error
    );


    res.status(500).json({
      success: false,
      message: "Unable to delete lead."
    });

  }

});


// ===============================
// ADD BUYER
// ===============================

app.post("/api/buyers", async (req, res) => {

  const password =
    req.headers["x-dashboard-password"];


  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }


  const {
    agencyName,
    contactName,
    email,
    phone
  } = req.body;


  if (!agencyName) {

    return res.status(400).json({
      success: false,
      message: "Agency name is required."
    });

  }


  try {

    const result =
      await pool.query(
        `
        INSERT INTO buyers
        (
          agency_name,
          contact_name,
          email,
          phone
        )
        VALUES ($1, $2, $3, $4)
        RETURNING *
        `,
        [
          agencyName,
          contactName || "",
          email || "",
          phone || ""
        ]
      );


    res.status(201).json({
      success: true,
      buyer: result.rows[0]
    });

  }


  catch (error) {

    console.error(
      "Error adding buyer:",
      error
    );


    res.status(500).json({
      success: false,
      message: "Unable to add buyer."
    });

  }

});


// ===============================
// GET BUYERS
// ===============================

app.get("/api/buyers", async (req, res) => {

  const password =
    req.headers["x-dashboard-password"];


  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }


  try {

    const result =
      await pool.query(
        "SELECT * FROM buyers ORDER BY created_at DESC"
      );


    res.json({
      success: true,
      buyers: result.rows
    });

  }


  catch (error) {

    console.error(
      "Error retrieving buyers:",
      error
    );


    res.status(500).json({
      success: false,
      message: "Unable to retrieve buyers."
    });

  }

});


// ===============================
// UPDATE BUYER
// ===============================

app.put("/api/buyers/:id", async (req, res) => {

  const password =
    req.headers["x-dashboard-password"];


  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }


  const { id } = req.params;


  const {
    agencyName,
    contactName,
    email,
    phone,
    active
  } = req.body;


  try {

    const result =
      await pool.query(
        `
        UPDATE buyers
        SET
          agency_name = $1,
          contact_name = $2,
          email = $3,
          phone = $4,
          active = $5
        WHERE id = $6
        RETURNING *
        `,
        [
          agencyName,
          contactName || "",
          email || "",
          phone || "",
          active,
          id
        ]
      );


    if (result.rows.length === 0) {

      return res.status(404).json({
        success: false,
        message: "Buyer not found."
      });

    }


    res.json({
      success: true,
      buyer: result.rows[0]
    });

  }


  catch (error) {

    console.error(
      "Error updating buyer:",
      error
    );


    res.status(500).json({
      success: false,
      message: "Unable to update buyer."
    });

  }

});


// ===============================
// DELETE BUYER
// ===============================

app.delete("/api/buyers/:id", async (req, res) => {

  const password =
    req.headers["x-dashboard-password"];


  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }


  const { id } = req.params;


  try {

    const result =
      await pool.query(
        "DELETE FROM buyers WHERE id = $1 RETURNING *",
        [id]
      );


    if (result.rows.length === 0) {

      return res.status(404).json({
        success: false,
        message: "Buyer not found."
      });

    }


    res.json({
      success: true,
      message: "Buyer deleted successfully."
    });

  }


  catch (error) {

    console.error(
      "Error deleting buyer:",
      error
    );


    res.status(500).json({
      success: false,
      message: "Unable to delete buyer."
    });

  }

});


// ===============================
// DELIVER LEAD TO BUYER
// ===============================

app.post("/api/leads/:id/deliver", async (req, res) => {

  const password =
    req.headers["x-dashboard-password"];


  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {

    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });

  }


  const { id } = req.params;

  const { buyerId } = req.body;


  if (!buyerId) {

    return res.status(400).json({
      success: false,
      message: "Buyer is required."
    });

  }


  try {

    // Find the lead

    const leadResult =
      await pool.query(
        "SELECT * FROM leads WHERE id = $1",
        [id]
      );


    if (leadResult.rows.length === 0) {

      return res.status(404).json({
        success: false,
        message: "Lead not found."
      });

    }


    const lead =
      leadResult.rows[0];


    // Find the buyer

    const buyerResult =
      await pool.query(
        `
        SELECT *
        FROM buyers
        WHERE id = $1
        AND active = TRUE
        `,
        [buyerId]
      );


    if (buyerResult.rows.length === 0) {

      return res.status(404).json({
        success: false,
        message: "Active buyer not found."
      });

    }


    const buyer =
      buyerResult.rows[0];


    if (!buyer.email) {

      return res.status(400).json({
        success: false,
        message: "This buyer does not have an email address."
      });

    }


    // Send the lead email

    const { data, error } =
      await resend.emails.send({

        from: "leads@securelifeinsurances.com",

        to: [buyer.email],

        subject:
          `New SecureLife Lead #${lead.id}`,

        html: `

          <h2>New SecureLife Lead</h2>

          <p>
            A new life insurance lead has been delivered to your agency.
          </p>

          <hr>

          <p>
            <strong>Name:</strong>
            ${lead.first_name} ${lead.last_name}
          </p>

          <p>
            <strong>Email:</strong>
            ${lead.email}
          </p>

          <p>
            <strong>Phone:</strong>
            ${lead.phone}
          </p>

          <p>
            <strong>ZIP:</strong>
            ${lead.zip}
          </p>

          <p>
            <strong>Age:</strong>
            ${lead.age}
          </p>

          <p>
            <strong>Coverage:</strong>
            ${lead.coverage}
          </p>

          <p>
            <strong>Insurance:</strong>
            ${lead.insurance}
          </p>

          <hr>

          <p>
            <strong>SecureLife Lead ID:</strong>
            ${lead.id}
          </p>

        `

      });


    if (error) {

      console.error(
        "Resend error:",
        error
      );


      return res.status(500).json({
        success: false,
        message: "Unable to send lead email."
      });

    }


    // Update lead with buyer

    await pool.query(
      `
      UPDATE leads
      SET
        buyer = $1,
        status = 'Delivered'
      WHERE id = $2
      `,
      [
        buyer.agency_name,
        id
      ]
    );


    console.log(
      `Lead #${id} delivered to ${buyer.agency_name}`
    );


    res.json({

      success: true,

      message:
        `Lead delivered to ${buyer.agency_name}.`,

      emailId:
        data ? data.id : null

    });

  }


  catch (error) {

    console.error(
      "Lead delivery error:",
      error
    );


    res.status(500).json({
      success: false,
      message: "Unable to deliver lead."
    });

  }

});


// ===============================
// START SERVER
// ===============================

const PORT =
  process.env.PORT || 10000;


app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `SecureLife backend running on port ${PORT}`
    );

  }
);
