// utils/emailService.js
const nodemailer = require("nodemailer");
const config = require("../config/config");
const fs = require("fs");
const path = require("path");

// Create reusable transporter with configuration from environment variables
const transporter = nodemailer.createTransport({
  host: config.email.host,
  port: config.email.port,
  secure: config.email.secure, // true for 465, false for other ports
  auth: {
    user: config.email.user,
    pass: config.email.password,
  },
  debug: true, // Enable debugging
  logger: true, // Log to console
});

/**
 * Send an email with optional attachments
 * @param {Object} options - Email options
 * @param {string} options.to - Recipient email
 * @param {string} [options.cc] - CC recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.text - Plain text email body
 * @param {string} [options.html] - HTML email body (optional)
 * @param {Array} [options.attachments] - Email attachments
 * @returns {Promise<Object>} Nodemailer response
 */
async function sendEmail({ to, cc, subject, text, html, attachments }) {
  try {
    console.log("Preparing to send email...");

    // Check attachment size and validity
    if (attachments && Array.isArray(attachments)) {
      for (let i = 0; i < attachments.length; i++) {
        const attachment = attachments[i];

        if (attachment.content && Buffer.isBuffer(attachment.content)) {
          console.log(
            `Attachment ${i + 1} size: ${attachment.content.length} bytes`
          );

          // Validate PDF
          if (attachment.contentType === "application/pdf") {
            if (attachment.content.length < 1000) {
              console.warn(
                `Warning: PDF attachment ${i + 1} is very small (${
                  attachment.content.length
                } bytes)`
              );
            }

            // Check for PDF header
            const header = attachment.content.slice(0, 4).toString();
            if (header !== "%PDF") {
              console.warn(
                `Warning: PDF attachment ${
                  i + 1
                } doesn't start with %PDF header!`
              );

              // Save invalid attachment for inspection
              const debugPath = path.join(
                __dirname,
                `../invalid-attachment-${Date.now()}.bin`
              );
              fs.writeFileSync(debugPath, attachment.content);
              console.log(`Saved invalid attachment to ${debugPath}`);
            }
          }
        } else {
          console.warn(
            `Warning: Attachment ${i + 1} doesn't have a valid buffer content`
          );
        }
      }
    }

    const mailOptions = {
      from: `"${config.email.senderName}" <${config.email.user}>`,
      to,
      subject,
      text,
    };

    // Add optional fields if provided
    if (cc) mailOptions.cc = cc;
    if (html) mailOptions.html = html;

    // Process attachments
    if (attachments && Array.isArray(attachments)) {
      // Properly format attachments for nodemailer
      mailOptions.attachments = attachments.map((attachment) => {
        // Ensure proper content-type is set
        return {
          filename: attachment.filename || "document.pdf",
          content: attachment.content,
          contentType: attachment.contentType || "application/pdf",
          encoding: "binary",
        };
      });
    }

    console.log("Sending email with options:", {
      to: mailOptions.to,
      subject: mailOptions.subject,
      hasAttachments: !!mailOptions.attachments,
      attachmentsCount: mailOptions.attachments
        ? mailOptions.attachments.length
        : 0,
    });

    // Send mail with defined transport object
    const info = await transporter.sendMail(mailOptions);
    console.log(`Email sent: ${info.messageId}`);
    return info;
  } catch (error) {
    console.error("Error sending email:", error);
    throw new Error(`Failed to send email: ${error.message}`);
  }
}

module.exports = {
  sendEmail,
};
