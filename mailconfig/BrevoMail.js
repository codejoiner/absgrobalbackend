const Brevo = require('@getbrevo/brevo');
require('dotenv').config()
const apiInstance = new Brevo.TransactionalEmailsApi();
apiInstance.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);

const transporter = async ({ to, subject, html, text }) => {
  const sendSmtpEmail = new Brevo.SendSmtpEmail();

  sendSmtpEmail.sender = {name: "ABSGROBAL", email: "codejoiner15@gmail.com" };
  sendSmtpEmail.to = [{ email: to }];
  sendSmtpEmail.subject = subject;
  sendSmtpEmail.htmlContent = html;
  
  if (text) sendSmtpEmail.textContent = text;

  try {
    const result = await apiInstance.sendTransacEmail(sendSmtpEmail);
    return { success: true, messageId: result.body.messageId };
  } catch (error) {
    console.error("Brevo Error:", error.response?.body || error.message);
    return { success: false, error: error.message };
  }
};

module.exports = transporter;