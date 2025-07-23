// config/config.js
// Add this to your existing config file

module.exports = {
  // Other configurations...

  // Email configuration
  email: {
    host: process.env.EMAIL_HOST || "ssl0.ovh.net",
    port: parseInt(process.env.EMAIL_PORT, 10) || 465,
    secure: true,
    user: process.env.EMAIL_USER || "commande@halalfs.com",
    password: process.env.EMAIL_PASSWORD || "azertyuiopqsdfghjklmwxcvbn",
    senderName: process.env.EMAIL_SENDER_NAME || "commande@halalfs.com",
  },
};
