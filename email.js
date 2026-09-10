const { Resend } = require("resend");

// Resend delivers immediately from this address without a verified domain.
// Once securelifeinsurances.com is verified, set LEAD_NOTIFICATION_FROM to
// a branded address such as "SecureLife <leads@securelifeinsurances.com>".
const FALLBACK_FROM = "SecureLife <beth.t@example.com>";

// Used when LEAD_NOTIFICATION_EMAIL is not set on the host (this is why the
// previous notification change never sent mail in production — it skipped).
const DEFAULT_NOTIFICATION_EMAIL = "geyermatt8@gmail.com";

function createResendClient() {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return null;
  }

  return new Resend(apiKey);
}

function getFromAddress() {
  const configured = (process.env.LEAD_NOTIFICATION_FROM || "").trim();
  return configured || FALLBACK_FROM;
}

function getNotificationRecipients() {
  const fromEnv = (process.env.LEAD_NOTIFICATION_EMAIL || "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);

  if (fromEnv.length > 0) {
    return fromEnv;
  }

  return [DEFAULT_NOTIFICATION_EMAIL];
}

function describeEmailConfig() {
  return {
    providerConfigured: Boolean(process.env.RESEND_API_KEY),
    recipientConfigured: getNotificationRecipients().length > 0,
    from: getFromAddress()
  };
}

function logEmailConfig() {
  const config = describeEmailConfig();

  if (!config.providerConfigured) {
    console.error(
      "Email DISABLED: RESEND_API_KEY is not set. " +
      "Add it on the Render service (Environment) or emails cannot send."
    );
    return config;
  }

  console.log(
    "Email enabled: notifying " +
    `${getNotificationRecipients().join(", ")} from ${config.from}`
  );
  return config;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isUnverifiedSenderError(error) {
  const message = String(
    (error && error.message) || error || ""
  ).toLowerCase();

  return (
    message.includes("domain is not verified") ||
    message.includes("not verified") ||
    message.includes("invalid `from`") ||
    message.includes("invalid from") ||
    (message.includes("from") && message.includes("must be"))
  );
}

function errorMessage(error) {
  if (!error) {
    return "Unknown email error.";
  }

  if (typeof error === "string") {
    return error;
  }

  return error.message || JSON.stringify(error);
}

function buildLeadNotificationContent(lead) {
  const name = `${lead.first_name} ${lead.last_name}`;
  const submitted = lead.created_at || "";
  const source = lead.source || "Direct/Unknown";
  const campaign = lead.campaign || "";

  const text =
    `New SecureLife lead #${lead.id}\n\n` +
    `Name: ${name}\n` +
    `Email: ${lead.email}\n` +
    `Phone: ${lead.phone}\n` +
    `ZIP: ${lead.zip}\n` +
    `Age: ${lead.age}\n` +
    `Coverage: ${lead.coverage}\n` +
    `Currently insured: ${lead.insurance}\n` +
    `Source: ${source}\n` +
    `Campaign: ${campaign}\n` +
    `Submitted: ${submitted}\n`;

  const html = `
    <h2>New SecureLife Lead</h2>
    <p>A new life insurance lead was just submitted.</p>
    <hr>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(lead.email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(lead.phone)}</p>
    <p><strong>ZIP:</strong> ${escapeHtml(lead.zip)}</p>
    <p><strong>Age:</strong> ${escapeHtml(lead.age)}</p>
    <p><strong>Coverage:</strong> ${escapeHtml(lead.coverage)}</p>
    <p><strong>Currently insured:</strong> ${escapeHtml(lead.insurance)}</p>
    <p><strong>Source:</strong> ${escapeHtml(source)}</p>
    <p><strong>Campaign:</strong> ${escapeHtml(campaign)}</p>
    <hr>
    <p><strong>Lead ID:</strong> ${escapeHtml(lead.id)}</p>
    <p><strong>Submitted:</strong> ${escapeHtml(submitted)}</p>
  `;

  return {
    subject: `New SecureLife Lead #${lead.id} - ${name}`,
    text,
    html
  };
}

function buildBuyerDeliveryContent(lead) {
  const name = `${lead.first_name} ${lead.last_name}`;

  const text =
    `A new life insurance lead has been delivered to your agency.\n\n` +
    `Name: ${name}\n` +
    `Email: ${lead.email}\n` +
    `Phone: ${lead.phone}\n` +
    `ZIP: ${lead.zip}\n` +
    `Age: ${lead.age}\n` +
    `Coverage: ${lead.coverage}\n` +
    `Insurance: ${lead.insurance}\n` +
    `SecureLife Lead ID: ${lead.id}\n`;

  const html = `
    <h2>New SecureLife Lead</h2>
    <p>A new life insurance lead has been delivered to your agency.</p>
    <hr>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>Email:</strong> ${escapeHtml(lead.email)}</p>
    <p><strong>Phone:</strong> ${escapeHtml(lead.phone)}</p>
    <p><strong>ZIP:</strong> ${escapeHtml(lead.zip)}</p>
    <p><strong>Age:</strong> ${escapeHtml(lead.age)}</p>
    <p><strong>Coverage:</strong> ${escapeHtml(lead.coverage)}</p>
    <p><strong>Insurance:</strong> ${escapeHtml(lead.insurance)}</p>
    <hr>
    <p><strong>SecureLife Lead ID:</strong> ${escapeHtml(lead.id)}</p>
  `;

  return {
    subject: `New SecureLife Lead #${lead.id}`,
    text,
    html
  };
}

async function sendWithFromFallback(resend, payload) {
  const preferredFrom = payload.from || getFromAddress();
  let usedFrom = preferredFrom;

  let result = await resend.emails.send({
    ...payload,
    from: preferredFrom
  });

  if (
    result.error &&
    preferredFrom !== FALLBACK_FROM &&
    isUnverifiedSenderError(result.error)
  ) {
    console.warn(
      `From address ${preferredFrom} was rejected (` +
      `${errorMessage(result.error)}). Retrying with ${FALLBACK_FROM}.`
    );

    usedFrom = FALLBACK_FROM;
    result = await resend.emails.send({
      ...payload,
      from: FALLBACK_FROM
    });
  }

  if (result.error) {
    throw new Error(errorMessage(result.error));
  }

  return {
    id: result.data ? result.data.id : null,
    from: usedFrom
  };
}

async function sendLeadNotification(resend, lead) {
  if (!resend) {
    const reason = "RESEND_API_KEY is not configured.";
    console.error(`Lead notification email skipped: ${reason}`);
    return { sent: false, skipped: true, reason };
  }

  const recipients = getNotificationRecipients();
  const content = buildLeadNotificationContent(lead);

  const sent = await sendWithFromFallback(resend, {
    from: getFromAddress(),
    to: recipients,
    replyTo: lead.email,
    subject: content.subject,
    text: content.text,
    html: content.html
  });

  console.log(
    `Lead #${lead.id} notification email sent to ` +
    `${recipients.join(", ")} from ${sent.from} (id: ${sent.id || "unknown"})`
  );

  return {
    sent: true,
    skipped: false,
    id: sent.id,
    from: sent.from,
    to: recipients
  };
}

async function sendBuyerLeadEmail(resend, { lead, buyer }) {
  if (!resend) {
    throw new Error("Email delivery is not configured.");
  }

  if (!buyer.email) {
    throw new Error("This buyer does not have an email address.");
  }

  const content = buildBuyerDeliveryContent(lead);

  const sent = await sendWithFromFallback(resend, {
    from: getFromAddress(),
    to: [buyer.email],
    replyTo: lead.email,
    subject: content.subject,
    text: content.text,
    html: content.html
  });

  return sent;
}

module.exports = {
  FALLBACK_FROM,
  DEFAULT_NOTIFICATION_EMAIL,
  createResendClient,
  getFromAddress,
  getNotificationRecipients,
  describeEmailConfig,
  logEmailConfig,
  escapeHtml,
  isUnverifiedSenderError,
  buildLeadNotificationContent,
  sendWithFromFallback,
  sendLeadNotification,
  sendBuyerLeadEmail
};
