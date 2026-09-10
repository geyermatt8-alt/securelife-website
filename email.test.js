const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { Resend } = require("resend");
const {
  FALLBACK_FROM,
  DEFAULT_NOTIFICATION_EMAIL,
  getFromAddress,
  getConfirmationFromAddress,
  getNotificationRecipients,
  describeEmailConfig,
  isUnverifiedSenderError,
  escapeHtml,
  formatCoverage,
  sendLeadConfirmation,
  sendLeadNotification,
  sendBuyerLeadEmail
} = require("./email");

async function withEnv(vars, fn) {
  const previous = {};

  for (const [key, value] of Object.entries(vars)) {
    previous[key] = process.env[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

function startMockResend(handler) {
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      let body = {};
      if (raw) {
        try {
          body = JSON.parse(raw);
        } catch {
          body = { raw };
        }
      }
      handler({ req, body, res });
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({
        server,
        port,
        url: `http://127.0.0.1:${port}`
      });
    });
  });
}

const sampleLead = {
  id: 42,
  first_name: "Ada",
  last_name: "Lovelace",
  email: "ada@example.com",
  phone: "555-0100",
  zip: "94105",
  age: "45",
  coverage: "250000",
  insurance: "No",
  source: "Google",
  campaign: "test",
  created_at: "2026-09-10T14:00:00.000Z"
};

describe("email configuration", () => {
  test("confirmation emails default to Resend's working from-address", () => {
    withEnv({
      LEAD_CONFIRMATION_FROM: undefined,
      LEAD_NOTIFICATION_FROM: undefined
    }, () => {
      assert.equal(getConfirmationFromAddress(), FALLBACK_FROM);
    });
  });

  test("formats coverage amounts for the confirmation email", () => {
    assert.equal(formatCoverage("250000"), "$250,000");
  });

  test("uses LEAD_NOTIFICATION_FROM when set", () => {
    withEnv(
      { LEAD_NOTIFICATION_FROM: "SecureLife <leads@securelifeinsurances.com>" },
      () => {
        assert.equal(
          getFromAddress(),
          "SecureLife <leads@securelifeinsurances.com>"
        );
      }
    );
  });

  test("defaults notification recipient so sends are not skipped", () => {
    withEnv({ LEAD_NOTIFICATION_EMAIL: undefined }, () => {
      assert.deepEqual(getNotificationRecipients(), [
        DEFAULT_NOTIFICATION_EMAIL
      ]);
    });
  });

  test("splits comma-separated LEAD_NOTIFICATION_EMAIL values", () => {
    withEnv(
      { LEAD_NOTIFICATION_EMAIL: "one@example.com, two@example.com" },
      () => {
        assert.deepEqual(getNotificationRecipients(), [
          "one@example.com",
          "two@example.com"
        ]);
      }
    );
  });

  test("health description reports whether a Resend key is present", () => {
    withEnv({ RESEND_API_KEY: undefined }, () => {
      assert.equal(describeEmailConfig().providerConfigured, false);
    });

    withEnv({ RESEND_API_KEY: "re_test" }, () => {
      assert.equal(describeEmailConfig().providerConfigured, true);
    });
  });

  test("detects unverified-domain errors from Resend", () => {
    assert.equal(
      isUnverifiedSenderError({
        message:
          "The securelifeinsurances.com domain is not verified. Please, add and verify your domain on https://resend.com/domains"
      }),
      true
    );
    assert.equal(
      isUnverifiedSenderError({ message: "Rate limit exceeded" }),
      false
    );
  });

  test("escapes HTML in lead fields", () => {
    assert.equal(escapeHtml('<img src=x onerror=alert(1)>'),
      "&lt;img src=x onerror=alert(1)&gt;");
  });
});

describe("sendLeadConfirmation", () => {
  test("sends a confirmation to the person who submitted the form", async () => {
    const captured = [];
    const mock = await startMockResend(({ body, res }) => {
      captured.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "email_confirm_1" }));
    });

    try {
      await withEnv(
        {
          RESEND_API_KEY: "re_test",
          LEAD_CONFIRMATION_FROM: undefined,
          LEAD_NOTIFICATION_FROM: undefined
        },
        async () => {
          const resend = new Resend("re_test");
          resend.baseUrl = mock.url;
          const result = await sendLeadConfirmation(resend, sampleLead);
          assert.equal(result.sent, true);
          assert.equal(result.id, "email_confirm_1");
          assert.deepEqual(result.to, ["ada@example.com"]);
          assert.equal(result.from, FALLBACK_FROM);
        }
      );
    } finally {
      mock.server.close();
    }

    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].to, ["ada@example.com"]);
    assert.equal(captured[0].from, FALLBACK_FROM);
    assert.equal(
      captured[0].subject,
      "We received your SecureLife quote request"
    );
    assert.match(captured[0].text, /Hi Ada/);
    assert.match(captured[0].html, /\$250,000/);
    assert.equal(captured[0].reply_to, "support@securelifeinsurances.com");
  });

  test("retries with the onboarding from-address when the branded domain is unverified", async () => {
    const captured = [];
    const mock = await startMockResend(({ body, res }) => {
      captured.push(body);
      if (String(body.from).includes("securelifeinsurances.com")) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          statusCode: 403,
          name: "validation_error",
          message:
            "The securelifeinsurances.com domain is not verified. Please, add and verify your domain on https://resend.com/domains"
        }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "email_confirm_retry" }));
    });

    try {
      await withEnv(
        {
          RESEND_API_KEY: "re_test",
          LEAD_CONFIRMATION_FROM:
            "SecureLife <leads@securelifeinsurances.com>"
        },
        async () => {
          const resend = new Resend("re_test");
          resend.baseUrl = mock.url;
          const result = await sendLeadConfirmation(resend, sampleLead);
          assert.equal(result.sent, true);
          assert.equal(result.id, "email_confirm_retry");
          assert.equal(result.from, FALLBACK_FROM);
          assert.deepEqual(result.to, ["ada@example.com"]);
        }
      );
    } finally {
      mock.server.close();
    }

    assert.equal(captured.length, 2);
    assert.match(captured[0].from, /securelifeinsurances.com/);
    assert.equal(captured[1].from, FALLBACK_FROM);
    assert.deepEqual(captured[1].to, ["ada@example.com"]);
  });
});

describe("sendLeadNotification", () => {
  test("skips clearly when Resend is not configured", async () => {
    const result = await sendLeadNotification(null, sampleLead);
    assert.equal(result.sent, false);
    assert.equal(result.skipped, true);
    assert.match(result.reason, /RESEND_API_KEY/);
  });

  test("sends a new-lead email to the default recipient", async () => {
    const captured = [];
    const mock = await startMockResend(({ body, res }) => {
      captured.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "email_test_1" }));
    });

    try {
      await withEnv(
        {
          RESEND_API_KEY: "re_test",
          RESEND_BASE_URL: mock.url,
          LEAD_NOTIFICATION_EMAIL: undefined,
          LEAD_NOTIFICATION_FROM: undefined
        },
        async () => {
          const resend = new Resend("re_test");
          // Constructor reads RESEND_BASE_URL at init; set baseUrl explicitly.
          resend.baseUrl = mock.url;
          const result = await sendLeadNotification(resend, sampleLead);
          assert.equal(result.sent, true);
          assert.equal(result.id, "email_test_1");
          assert.deepEqual(result.to, [DEFAULT_NOTIFICATION_EMAIL]);
          assert.equal(result.from, FALLBACK_FROM);
        }
      );
    } finally {
      mock.server.close();
    }

    assert.equal(captured.length, 1);
    assert.equal(captured[0].from, FALLBACK_FROM);
    assert.deepEqual(captured[0].to, [DEFAULT_NOTIFICATION_EMAIL]);
    assert.equal(
      captured[0].subject,
      "New SecureLife Lead #42 - Ada Lovelace"
    );
    assert.match(captured[0].html, /Ada Lovelace/);
    assert.match(captured[0].text, /555-0100/);
    assert.equal(captured[0].reply_to, "ada@example.com");
  });

  test("retries with the onboarding from-address when the domain is unverified", async () => {
    const captured = [];
    const mock = await startMockResend(({ body, res }) => {
      captured.push(body);
      if (String(body.from).includes("securelifeinsurances.com")) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          statusCode: 403,
          name: "validation_error",
          message:
            "The securelifeinsurances.com domain is not verified. Please, add and verify your domain on https://resend.com/domains"
        }));
        return;
      }

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "email_retry_ok" }));
    });

    try {
      await withEnv(
        {
          RESEND_API_KEY: "re_test",
          LEAD_NOTIFICATION_FROM:
            "SecureLife <leads@securelifeinsurances.com>"
        },
        async () => {
          const resend = new Resend("re_test");
          resend.baseUrl = mock.url;
          const result = await sendLeadNotification(resend, sampleLead);
          assert.equal(result.sent, true);
          assert.equal(result.id, "email_retry_ok");
          assert.equal(result.from, FALLBACK_FROM);
        }
      );
    } finally {
      mock.server.close();
    }

    assert.equal(captured.length, 2);
    assert.match(captured[0].from, /securelifeinsurances.com/);
    assert.equal(captured[1].from, FALLBACK_FROM);
  });
});

describe("sendBuyerLeadEmail", () => {
  test("sends the lead details to the buyer", async () => {
    const captured = [];
    const mock = await startMockResend(({ body, res }) => {
      captured.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "email_buyer_1" }));
    });

    try {
      const resend = new Resend("re_test");
      resend.baseUrl = mock.url;
      const sent = await sendBuyerLeadEmail(resend, {
        lead: sampleLead,
        buyer: { email: "buyer@agency.test", agency_name: "Test Agency" }
      });
      assert.equal(sent.id, "email_buyer_1");
    } finally {
      mock.server.close();
    }

    assert.equal(captured.length, 1);
    assert.deepEqual(captured[0].to, ["buyer@agency.test"]);
    assert.match(captured[0].html, /Ada Lovelace/);
  });
});
