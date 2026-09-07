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


// ========================================
// DATABASE SETUP
// ========================================

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

  await pool.query(`
    ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'New',
    ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS buyer TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS price NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS source TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS campaign TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS date_sold TIMESTAMP,
    ADD COLUMN IF NOT EXISTS refund_amount NUMERIC DEFAULT 0,
    ADD COLUMN IF NOT EXISTS refund_reason TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS refund_date TIMESTAMP
  `);

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

  console.log("Database connected and ready");
}


// ========================================
// GOOGLE SHEETS SYNC
// ========================================

async function syncLeadToGoogleSheet(lead) {
  if (
    !process.env.GOOGLE_SHEETS_WEBHOOK_URL ||
    !process.env.SYNC_SECRET
  ) {
    throw new Error(
      "Google Sheets sync environment variables are missing."
    );
  }

  const response = await fetch(
    process.env.GOOGLE_SHEETS_WEBHOOK_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        secret: process.env.SYNC_SECRET,
        id: lead.id,
        createdAt: lead.created_at,
        source: lead.source || "",
        status: lead.status || "New",
        buyer: lead.buyer || "",
        dateSold: lead.date_sold || "",
        price: lead.price || 0,
        refundAmount: lead.refund_amount || 0,
        campaign: lead.campaign || "",
        refundReason: lead.refund_reason || "",
        refundDate: lead.refund_date || ""
      })
    }
  );

  const responseText = await response.text();
  let result;

  try {
    result = JSON.parse(responseText);
  } catch {
    throw new Error(
      "Google Sheets returned an invalid response."
    );
  }

  if (!response.ok || result.success !== true) {
    throw new Error(
      result.message ||
      `Google Sheets sync failed with status ${response.status}.`
    );
  }

  return result;
}


// ========================================
// DASHBOARD AUTHORIZATION
// ========================================

function authorizeDashboard(req, res, next) {
  const password = req.headers["x-dashboard-password"];

  if (
    !password ||
    password !== process.env.DASHBOARD_PASSWORD
  ) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized"
    });
  }

  next();
}


// ========================================
// HEALTH CHECK
// ========================================

app.get("/api/healthz", (req, res) => {
  res.json({
    status: "ok",
    message: "SecureLife backend is running"
  });
});


// ========================================
// RECEIVE NEW LEAD
// ========================================

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
    source,
    campaign
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
    const insertResult = await pool.query(
      `
      INSERT INTO leads (
        first_name,
        last_name,
        email,
        phone,
        zip,
        age,
        coverage,
        insurance,
        consent,
        source,
        campaign
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11
      )
      RETURNING *
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
        source || "",
        campaign || ""
      ]
    );

    const savedLead = insertResult.rows[0];
    let reportingSynced = true;

    try {
      await syncLeadToGoogleSheet(savedLead);

      console.log(
        `Lead #${savedLead.id} synced to Google Sheets`
      );
    } catch (syncError) {
      reportingSynced = false;

      console.error(
        "Google Sheets sync error:",
        syncError
      );
    }

    console.log(
      "New SecureLife lead saved to database"
    );

    return res.status(201).json({
      success: true,
      message: "Your information has been received.",
      leadId: savedLead.id,
      reportingSynced
    });

  } catch (error) {
    console.error("Database error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to save your information."
    });
  }
});


// ========================================
// GET ALL LEADS
// ========================================

app.get(
  "/api/leads",
  authorizeDashboard,
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM leads ORDER BY created_at DESC"
      );

      return res.json({
        success: true,
        leads: result.rows
      });

    } catch (error) {
      console.error(
        "Error retrieving leads:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to retrieve leads."
      });
    }
  }
);


// ========================================
// UPDATE LEAD
// ========================================

app.put(
  "/api/leads/:id",
  authorizeDashboard,
  async (req, res) => {
    const { id } = req.params;

    const {
      status,
      notes,
      buyer,
      price,
      source,
      campaign,
      dateSold,
      refundAmount,
      refundReason,
      refundDate
    } = req.body;

    try {
      const result = await pool.query(
        `
        UPDATE leads
        SET
          status = COALESCE($1, status),
          notes = COALESCE($2, notes),
          buyer = COALESCE($3, buyer),
          price = COALESCE($4, price),
          source = COALESCE($5, source),
          campaign = COALESCE($6, campaign),
          date_sold = COALESCE($7, date_sold),
          refund_amount = COALESCE($8, refund_amount),
          refund_reason = COALESCE($9, refund_reason),
          refund_date = COALESCE($10, refund_date)
        WHERE id = $11
        RETURNING *
        `,
        [
          status ?? null,
          notes ?? null,
          buyer ?? null,
          price ?? null,
          source ?? null,
          campaign ?? null,
          dateSold || null,
          refundAmount ?? null,
          refundReason ?? null,
          refundDate || null,
          id
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Lead not found."
        });
      }

      try {
        await syncLeadToGoogleSheet(result.rows[0]);

        console.log(
          `Lead #${id} update synced to Google Sheets`
        );
      } catch (syncError) {
        console.error(
          "Google Sheets update sync error:",
          syncError
        );
      }

      return res.json({
        success: true,
        lead: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Error updating lead:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to update lead."
      });
    }
  }
);


// ========================================
// DELETE LEAD
// ========================================

app.delete(
  "/api/leads/:id",
  authorizeDashboard,
  async (req, res) => {
    const { id } = req.params;

    try {
      const result = await pool.query(
        "DELETE FROM leads WHERE id = $1 RETURNING *",
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Lead not found."
        });
      }

      return res.json({
        success: true,
        message: "Lead deleted successfully."
      });

    } catch (error) {
      console.error(
        "Error deleting lead:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to delete lead."
      });
    }
  }
);


// ========================================
// ADD BUYER
// ========================================

app.post(
  "/api/buyers",
  authorizeDashboard,
  async (req, res) => {
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
      const result = await pool.query(
        `
        INSERT INTO buyers (
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

      return res.status(201).json({
        success: true,
        buyer: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Error adding buyer:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to add buyer."
      });
    }
  }
);


// ========================================
// GET BUYERS
// ========================================

app.get(
  "/api/buyers",
  authorizeDashboard,
  async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT * FROM buyers ORDER BY created_at DESC"
      );

      return res.json({
        success: true,
        buyers: result.rows
      });

    } catch (error) {
      console.error(
        "Error retrieving buyers:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to retrieve buyers."
      });
    }
  }
);


// ========================================
// UPDATE BUYER
// ========================================

app.put(
  "/api/buyers/:id",
  authorizeDashboard,
  async (req, res) => {
    const { id } = req.params;

    const {
      agencyName,
      contactName,
      email,
      phone,
      active
    } = req.body;

    try {
      const result = await pool.query(
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

      return res.json({
        success: true,
        buyer: result.rows[0]
      });

    } catch (error) {
      console.error(
        "Error updating buyer:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to update buyer."
      });
    }
  }
);


// ========================================
// DELETE BUYER
// ========================================

app.delete(
  "/api/buyers/:id",
  authorizeDashboard,
  async (req, res) => {
    const { id } = req.params;

    try {
      const result = await pool.query(
        "DELETE FROM buyers WHERE id = $1 RETURNING *",
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Buyer not found."
        });
      }

      return res.json({
        success: true,
        message: "Buyer deleted successfully."
      });

    } catch (error) {
      console.error(
        "Error deleting buyer:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to delete buyer."
      });
    }
  }
);


// ========================================
// DELIVER LEAD TO BUYER
// ========================================

app.post(
  "/api/leads/:id/deliver",
  authorizeDashboard,
  async (req, res) => {
    const { id } = req.params;
    const { buyerId } = req.body;

    if (!buyerId) {
      return res.status(400).json({
        success: false,
        message: "Buyer is required."
      });
    }

    try {
      const leadResult = await pool.query(
        "SELECT * FROM leads WHERE id = $1",
        [id]
      );

      if (leadResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          message: "Lead not found."
        });
      }

      const lead = leadResult.rows[0];

      const buyerResult = await pool.query(
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

      const buyer = buyerResult.rows[0];

      if (!buyer.email) {
        return res.status(400).json({
          success: false,
          message:
            "This buyer does not have an email address."
        });
      }

      const { data, error } =
        await resend.emails.send({
          from: "leads@securelifeinsurances.com",
          to: [buyer.email],
          subject: `New SecureLife Lead #${lead.id}`,
          html: `
            <h2>New SecureLife Lead</h2>

            <p>
              A new life insurance lead has been
              delivered to your agency.
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
        console.error("Resend error:", error);

        return res.status(500).json({
          success: false,
          message: "Unable to send lead email."
        });
      }

      const deliveryUpdate = await pool.query(
        `
        UPDATE leads
        SET
          buyer = $1,
          status = 'Delivered'
        WHERE id = $2
        RETURNING *
        `,
        [
          buyer.agency_name,
          id
        ]
      );

      try {
        await syncLeadToGoogleSheet(
          deliveryUpdate.rows[0]
        );

        console.log(
          `Lead #${id} delivery synced to Google Sheets`
        );
      } catch (syncError) {
        console.error(
          "Google Sheets delivery sync error:",
          syncError
        );
      }

      console.log(
        `Lead #${id} delivered to ${buyer.agency_name}`
      );

      return res.json({
        success: true,
        message:
          `Lead delivered to ${buyer.agency_name}.`,
        emailId: data ? data.id : null
      });

    } catch (error) {
      console.error(
        "Lead delivery error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to deliver lead."
      });
    }
  }
);


// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 10000;

async function startServer() {
  try {
    await setupDatabase();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(
        `SecureLife backend running on port ${PORT}`
      );
    });

  } catch (error) {
    console.error(
      "Unable to initialize database:",
      error
    );

    process.exit(1);
  }
}

startServer();
