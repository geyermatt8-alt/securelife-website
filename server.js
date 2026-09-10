const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const {
  createResendClient,
  describeEmailConfig,
  logEmailConfig,
  sendLeadConfirmation,
  sendLeadNotification,
  sendBuyerLeadEmail
} = require("./email");

const app = express();

app.set("trust proxy", 1);

const CONSENT_VERSION =
  "securelife-consent-v1-2026-09-08";

const CONSENT_TEXT =
  "By checking this box and submitting this form, I provide my electronic signature and agree that SecureLife may contact me by telephone, text message, or email regarding my life insurance request. I also authorize SecureLife to share my information with a licensed insurance agent or agency that may contact me about life insurance options. Consent is not a condition of purchasing any product or service. Message and data rates may apply. I can opt out of text messages by replying STOP. I have read the Privacy Policy.";

const resend = createResendClient();

app.use(cors());
app.use(express.json({ limit: "32kb" }));

const databaseUrl = process.env.DATABASE_URL || "";
const isLocalDatabase =
  !databaseUrl || /localhost|127\.0\.0\.1/.test(databaseUrl);

const pool = new Pool({
  connectionString: databaseUrl || undefined,
  ssl: isLocalDatabase
    ? false
    : {
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
    ADD COLUMN IF NOT EXISTS refund_date TIMESTAMP,
    ADD COLUMN IF NOT EXISTS consent_version TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS consent_text TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS consent_timestamp TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consent_ip TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS consent_user_agent TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS consent_page_url TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS notification_email_status TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS notification_email_error TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS notification_email_id TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS confirmation_email_status TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS confirmation_email_error TEXT DEFAULT '',
    ADD COLUMN IF NOT EXISTS confirmation_email_id TEXT DEFAULT ''
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
      `Google Sheets returned non-JSON (${response.status}): ${responseText.slice(0, 300)}`
    );
  }

  if (!response.ok || result.success !== true) {
    throw new Error(
      result.message ||
      `Google Sheets sync failed with status ${response.status}.}.`
    );
  }

  return result;
}


async function recordEmailResult(leadId, kind, result) {
  const columns = {
    notification: [
      "notification_email_status",
      "notification_email_error",
      "notification_email_id"
    ],
    confirmation: [
      "confirmation_email_status",
      "confirmation_email_error",
      "confirmation_email_id"
    ]
  }[kind];

  if (!columns) {
    return;
  }

  try {
    await pool.query(
      `
      UPDATE leads
      SET
        ${columns[0]} = $1,
        ${columns[1]} = $2,
        ${columns[2]} = $3
      WHERE id = $4
      `,
      [
        result.status,
        result.error || "",
        result.id || "",
        leadId
      ]
    );
  } catch (error) {
    console.error(
      `Unable to record ${kind} email status:`,
      error
    );
  }
}


// ========================================
// BACKGROUND POST-SUBMISSION WORK
// ========================================
//
// Runs the slow third-party integrations (reporting sync + notification
// email) after the visitor already received their response, so neither the
// latency nor the failure of these calls affects the submission experience.

function processNewLeadSideEffects(lead) {
  syncLeadToGoogleSheet(lead)
    .then(() => {
      console.log(`Lead #${lead.id} synced to Google Sheets`);
    })
    .catch((syncError) => {
      console.error("Google Sheets sync error:", syncError);
    });

  sendLeadConfirmation(resend, lead)
    .then((result) => {
      return recordEmailResult(lead.id, "confirmation", {
        status: result.sent ? "sent" : "skipped",
        error: result.reason || "",
        id: result.id || ""
      });
    })
    .catch((emailError) => {
      console.error("Lead confirmation email error:", emailError);
      return recordEmailResult(lead.id, "confirmation", {
        status: "failed",
        error: emailError.message || String(emailError),
        id: ""
      });
    });

  sendLeadNotification(resend, lead)
    .then((result) => {
      return recordEmailResult(lead.id, "notification", {
        status: result.sent ? "sent" : "skipped",
        error: result.reason || "",
        id: result.id || ""
      });
    })
    .catch((emailError) => {
      console.error("Lead notification email error:", emailError);
      return recordEmailResult(lead.id, "notification", {
        status: "failed",
        error: emailError.message || String(emailError),
        id: ""
      });
    });
}


// ========================================
// DASHBOARD AUTHORIZATION
// ========================================

function authorizeDashboard(req, res, next) {
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

  next();
}


// ========================================
// HEALTH CHECK
// ========================================

app.get("/api/healthz", (req, res) => {
  const email = describeEmailConfig();

  res.json({
    status: "ok",
    message: "SecureLife backend is running",
    email: {
      configured: email.providerConfigured,
      from: email.from,
      confirmationFrom: email.confirmationFrom
    }
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
    campaign,
    pageUrl
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

  const forwardedFor =
    req.headers["x-forwarded-for"];

  const consentIp = forwardedFor
    ? String(forwardedFor).split(",")[0].trim()
    : req.ip || "";

  const consentUserAgent =
    req.get("user-agent") || "";

  const consentPageUrl =
    pageUrl ||
    req.get("referer") ||
    req.get("origin") ||
    "";

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
        campaign,
        consent_version,
        consent_text,
        consent_timestamp,
        consent_ip,
        consent_user_agent,
        consent_page_url
      )
      VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12,
        $13, CURRENT_TIMESTAMP, $14, $15, $16
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
        source || "Direct/Unknown",
        campaign || "",
        CONSENT_VERSION,
        CONSENT_TEXT,
        consentIp,
        consentUserAgent,
        consentPageUrl
      ]
    );

    const savedLead = insertResult.rows[0];

    console.log(
      "New SecureLife lead saved to database"
    );

    // Respond as soon as the lead is safely stored so the browser can
    // redirect to the thank-you page immediately. The reporting sync and
    // notification email are slow, third-party calls, so they run in the
    // background and must never delay (or fail) the visitor's submission.
    res.status(201).json({
      success: true,
      message: "Your information has been received.",
      leadId: savedLead.id
    });

    processNewLeadSideEffects(savedLead);
    return;

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
          refund_amount = COALESCE(
            $8,
            refund_amount
          ),
          refund_reason = COALESCE(
            $9,
            refund_reason
          ),
          refund_date = COALESCE(
            $10,
            refund_date
          )
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
        await syncLeadToGoogleSheet(
          result.rows[0]
        );

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
        `
        DELETE FROM leads
        WHERE id = $1
        RETURNING *
        `,
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
        `
        SELECT *
        FROM buyers
        ORDER BY created_at DESC
        `
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
        `
        DELETE FROM buyers
        WHERE id = $1
        RETURNING *
        `,
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
        `
        SELECT *
        FROM leads
        WHERE id = $1
        `,
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

      if (!resend) {
        return res.status(500).json({
          success: false,
          message:
            "Email delivery is not configured. Set RESEND_API_KEY on Render."
        });
      }

      let deliveryEmail;
      try {
        deliveryEmail = await sendBuyerLeadEmail(resend, {
          lead,
          buyer
        });
      } catch (emailError) {
        console.error("Resend error:", emailError);

        return res.status(500).json({
          success: false,
          message: emailError.message || "Unable to send lead email."
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
        emailId: deliveryEmail.id || null
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
    logEmailConfig();

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
