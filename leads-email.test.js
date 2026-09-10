const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { Pool } = require("pg");
const { FALLBACK_FROM, DEFAULT_NOTIFICATION_EMAIL } = require("./email");

const DATABASE_URL =
  process.env.TEST_DATABASE_URL ||
  "postgresql://securelife:securelife@localhost:5432/securelife";

const capturedEmails = [];
let mockResend;
let serverProcess;
let apiBase;

function startMockResend() {
  return new Promise((resolve) => {
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
        capturedEmails.push({
          path: req.url,
          method: req.method,
          body
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: `email_${capturedEmails.length}` }));
      });
    });

    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`
      });
    });
  });
}

function waitForOutput(child, pattern, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let combined = child.output || "";
    if (pattern.test(combined)) {
      resolve(combined);
      return;
    }

    const timer = setTimeout(() => {
      reject(
        new Error(
          `Timed out waiting for ${pattern}. Output so far:\n${combined}`
        )
      );
    }, timeoutMs);

    function onData(chunk) {
      combined += chunk.toString();
      if (pattern.test(combined)) {
        clearTimeout(timer);
        child.stdout.off("data", onData);
        child.stderr.off("data", onData);
        resolve(combined);
      }
    }

    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
  });
}

function startBackend({ resendUrl, port }) {
  const child = spawn("node", ["server.js"], {
    cwd: __dirname,
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL,
      DASHBOARD_PASSWORD: "dev-dashboard-pass",
      RESEND_API_KEY: "re_test_key",
      RESEND_BASE_URL: resendUrl,
      LEAD_NOTIFICATION_EMAIL: "",
      LEAD_NOTIFICATION_FROM: "",
      GOOGLE_SHEETS_WEBHOOK_URL: "",
      SYNC_SECRET: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.output = "";
  child.stdout.on("data", (chunk) => {
    child.output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    child.output += chunk;
  });
  return child;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(port);
        }
      });
    });
  });
}

async function waitForEmail(predicate, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const match = capturedEmails.find(predicate);
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Email was not sent in time. Captured: ${JSON.stringify(capturedEmails)}`
  );
}

before(async () => {
  mockResend = await startMockResend();
  const port = await getFreePort();
  apiBase = `http://127.0.0.1:${port}`;
  serverProcess = startBackend({
    resendUrl: mockResend.url,
    port
  });
  try {
    await waitForOutput(
      serverProcess,
      /SecureLife backend running on port/
    );
  } catch (error) {
    throw new Error(
      `${error.message}\nServer output:\n${serverProcess.output || ""}`
    );
  }
});

after(async () => {
  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }
  if (mockResend) {
    mockResend.server.close();
  }
});

test("healthz reports email as configured", async () => {
  const response = await fetch(`${apiBase}/api/healthz`);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.email.configured, true);
  assert.equal(body.email.from, FALLBACK_FROM);
});

test("submitting a lead sends a notification email without waiting on Resend", async () => {
  capturedEmails.length = 0;
  const suffix = Date.now();

  const started = Date.now();
  const response = await fetch(`${apiBase}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      firstName: "Test",
      lastName: `Lead${suffix}`,
      email: `test.lead.${suffix}@example.com`,
      phone: "5551112222",
      zip: "10001",
      age: "40",
      coverage: "100000",
      insurance: "No",
      consent: true,
      source: "Direct/Unknown",
      campaign: "email-fix-test"
    })
  });
  const elapsedMs = Date.now() - started;
  const body = await response.json();

  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.ok(body.leadId);
  assert.ok(
    elapsedMs < 1500,
    `submission should return quickly, took ${elapsedMs}ms`
  );

  const email = await waitForEmail(
    (item) => item.body && item.body.subject &&
      item.body.subject.includes(`Lead #${body.leadId}`)
  );

  assert.equal(email.body.from, FALLBACK_FROM);
  assert.deepEqual(email.body.to, [DEFAULT_NOTIFICATION_EMAIL]);
  assert.match(email.body.html, new RegExp(`Lead${suffix}`));
  assert.match(email.body.text, /5551112222/);

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  try {
    const deadline = Date.now() + 8000;
    let saved;
    while (Date.now() < deadline) {
      const result = await pool.query(
        "SELECT notification_email_status, notification_email_id FROM leads WHERE id = $1",
        [body.leadId]
      );
      saved = result.rows[0];
      if (saved && saved.notification_email_status === "sent") {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(saved.notification_email_status, "sent");
    assert.ok(saved.notification_email_id);
  } finally {
    await pool.end();
  }
});
