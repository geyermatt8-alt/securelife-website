const { Resend } = require("resend");

// Resend delivers immediately from this address without a verified domain.
// Confirmation emails use this by default so a form submission can actually
// send mail before securelifeinsurances.com is verified. Resend's test mode
// still only delivers to the email on the Resend account.
const FALLBACK_FROM = "SecureLife <beth.t@example.com>";

const BRANDED_FROM = "SecureLife <leads@securelifeinsurances.com>";
const SUPPORT_EMAIL = "support@securelifeinsurances.com";

// Used when LEAD_NOTIFICATION_EMAIL is not set on the host.
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

function getConfirmationFromAddress() {
  return (
    (process.env.LEAD_CONFIRMATION_FROM || "").trim() ||
    (process.env.LEAD_NOTIFICATION_FROM || "").trim() ||
    FALLBACK_FROM
  );
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
    from: getFromAddress(),
    confirmationFrom: getConfirmationFromAddress()
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
    "Email enabled: visitor confirmation from " +
    `${config.confirmationFrom}; owner alerts to ` +
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
    message.includes("you can only send testing emails") ||
    (message.includes("from") && message.includes("must be"))
  );
}

function formatCoverage(value) {
  const amount = Number(String(value ?? "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) {
    return String(value ?? "");
  }

  return amount.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  });
}

function formatInsurance(value) {
  const normalized = String(value ?? "").toLowerCase();
  if (normalized === "yes") {
    return "Yes";
  }
  if (normalized === "no") {
    return "No";
  }
  if (normalized === "not-sure" || normalized === "not sure") {
    return "Not sure";
  }
  return String(value ?? "");
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

function domainHint(error) {
  if (!isUnverifiedSenderError(error)) {
    return errorMessage(error);
  }

  return (
    errorMessage(error) +
    " Visitor confirmation emails require verifying" +
    " securelifeinsurances.com in Resend (https://resend.com/domains)" +
    " and sending from leads@securelifeinsurances.com."
  );
}

function buildLeadConfirmationContent(lead) {
  const firstName = lead.first_name || "there";
  const coverage = formatCoverage(lead.coverage);
  const insured = formatInsurance(lead.insurance);

  const text =
    `Hi ${firstName},\n\n` +
    `Thank you for requesting a free life insurance quote from SecureLife. ` +
    `We have received your information.\n\n` +
    `A licensed insurance professional may contact you shortly about the ` +
    `options you requested. Please keep your phone and email available.\n\n` +
    `Here is what you submitted:\n` +
    `Name: ${lead.first_name} ${lead.last_name}\n` +
    `Email: ${lead.email}\n` +
    `Phone: ${lead.phone}\n` +
    `ZIP: ${lead.zip}\n` +
    `Age: ${lead.age}\n` +
    `Coverage: ${coverage}\n` +
    `Currently insured: ${insured}\n\n` +
    `This is a confirmation only. It is not an insurance policy, a quote ` +
    `guarantee, or an obligation to buy.\n\n` +
    `Questions? Email ${SUPPORT_EMAIL}\n\n` +
    `SecureLife\n`;

  const html = `
    <div style="font-family: Arial, Helvetica, sans-serif; color: #12263a; line-height: 1.5; max-width: 560px;">
      <p style="font-size: 13px; letter-spacing: 0.08em; text-transform: uppercase; color: #0f766e; margin: 0 0 12px;">SecureLife</p>
      <h1 style="font-size: 22px; margin: 0 0 16px;">We received your quote request</h1>
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>
        Thank you for requesting a free life insurance quote from SecureLife.
        We have received your information.
      </p>
      <p>
        A licensed insurance professional may contact you shortly about the
        options you requested. Please keep your phone and email available.
      </p>
      <table style="border-collapse: collapse; width: 100%; margin: 20px 0;">
        <tr><td style="padding: 6px 0; color: #5b6b7c;">Name</td><td style="padding: 6px 0;">${escapeHtml(lead.first_name)} ${escapeHtml(lead.last_name)}</td></tr>
        <tr><td style="padding: 6px 0; color: #5b6b7c;">Email</td><td style="padding: 6px 0;">${escapeHtml(lead.email)}</td></tr>
        <tr><td style="padding: 6px 0; color: #5b6b7c;">Phone</td><td style="padding: 6px 0;">${escapeHtml(lead.phone)}</td></tr>
        <tr><td style="padding: 6px 0; color: #5b6b7c;">ZIP</td><td style="padding: 6px 0;">${escapeHtml(lead.zip)}</td></tr>
        <tr><td style="padding: 6px 0; color: #5b6b7c;">Age</td><td style="padding: 6px 0;">${escapeHtml(lead.age)}</td></tr>
        <tr><td style="padding: 6px 0; color: #5b6b7c;">Coverage</td><td style="padding: 6px 0;">${escapeHtml(coverage)}</td></tr>
        <tr><td style="padding: 6px 0; color: #5b6b7c;">Currently insured</td><td style="padding: 6px 0;">${escapeHtml(insured)}</td></tr>
      </table>
      <p style="font-size: 13px; color: #5b6b7c;">
        This is a confirmation only. It is not an insurance policy, a quote
        guarantee, or an obligation to buy.
      </p>
      <p>Questions? Email <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>
      <p>SecureLife</p>
    </div>
  `;

  return {
    subject: "We received your SecureLife quote request",
    text,
    html
  };
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
    throw new Error(domainHint(result.error));
  }

  return {
    id: result.data ? result.data.id : null,
    from: usedFrom
  };
}

async function sendLeadConfirmation(resend, lead) {
  if (!resend) {
    const reason = "RESEND_API_KEY is not configured.";
    console.error(`Lead confirmation email skipped: ${reason}`);
    return { sent: false, skipped: true, reason };
  }

  if (!lead.email) {
    const reason = "Lead email address is missing.";
    console.error(`Lead confirmation email skipped: ${reason}`);
    return { sent: false, skipped: true, reason };
  }

  const from = getConfirmationFromAddress();
  const content = buildLeadConfirmationContent(lead);

  const sent = await sendWithFromFallback(resend, {
    from,
    to: [lead.email],
    replyTo: SUPPORT_EMAIL,
    subject: content.subject,
    text: content.text,
    html: content.html
  });

  console.log(
    `Lead #${lead.id} confirmation email sent to ${lead.email} ` +
    `from ${sent.from} (id: ${sent.id || "unknown"})`
  );

  return {
    sent: true,
    skipped: false,
    id: sent.id,
    from: sent.from,
    to: [lead.email]
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
    from: getConfirmationFromAddress(),
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
  BRANDED_FROM,
  SUPPORT_EMAIL,
  DEFAULT_NOTIFICATION_EMAIL,
  createResendClient,
  getFromAddress,
  getConfirmationFromAddress,
  getNotificationRecipients,
  describeEmailConfig,
  logEmailConfig,
  escapeHtml,
  formatCoverage,
  formatInsurance,
  isUnverifiedSenderError,
  buildLeadConfirmationContent,
  buildLeadNotificationContent,
  sendWithFromFallback,
  sendLeadConfirmation,
  sendLeadNotification,
  sendBuyerLeadEmail
};
