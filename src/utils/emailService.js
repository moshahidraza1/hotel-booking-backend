import { Resend } from "resend";
import { ApiError } from "./ApiError.js";

const resend = new Resend(process.env.RESEND_API_KEY);

const EMAIL_TEMPLATES = {
  VERIFICATION: "verification",
  BOOKING_CONFIRMATION: "booking-confirmation",
  PAYMENT_SUCCESS: "payment-success",
  PAYMENT_FAILURE: "payment-failure",
  PASSWORD_RESET: "password-reset",
};

const getEmailTemplate = (templateType, data) => {
  const templates = {
    [EMAIL_TEMPLATES.VERIFICATION]: {
      subject: "Verify Your Email Address",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 5px; }
              .content { padding: 20px 0; }
              .button { 
                display: inline-block; 
                padding: 12px 30px; 
                background-color: #007bff; 
                color: white; 
                text-decoration: none; 
                border-radius: 5px; 
                margin: 20px 0;
              }
              .footer { background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #666; }
              .warning { color: #dc3545; font-size: 12px; margin-top: 10px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Email Verification</h1>
              </div>
              <div class="content">
                <p>Hello ${data.firstName},</p>
                <p>Thank you for registering with us! Please verify your email address by clicking the button below:</p>
                <a href="${data.verificationLink}" class="button">Verify Email</a>
                <p>Or copy and paste this link in your browser:</p>
                <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 5px;">
                  ${data.verificationLink}
                </p>
                <p class="warning">This link will expire in 24 hours. If you didn't create this account, please ignore this email.</p>
              </div>
              <div class="footer">
                <p>&copy; 2026 Hotel Booking. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    },
    [EMAIL_TEMPLATES.BOOKING_CONFIRMATION]: {
      subject: `Booking Confirmation - ${data.bookingReference}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #28a745; padding: 20px; color: white; text-align: center; border-radius: 5px; }
              .booking-details { background-color: #f8f9fa; padding: 20px; margin: 20px 0; border-radius: 5px; }
              .detail-row { display: flex; justify-content: space-between; padding: 8px 0; border-bottom: 1px solid #ddd; }
              .detail-label { font-weight: bold; }
              .footer { background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Booking Confirmed!</h1>
              </div>
              <div style="padding: 20px 0;">
                <p>Hello ${data.guestName},</p>
                <p>Your booking has been confirmed. Here are the details:</p>
                
                <div class="booking-details">
                  <div class="detail-row">
                    <span class="detail-label">Booking Reference:</span>
                    <span>${data.bookingReference}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Room Type:</span>
                    <span>${data.roomType}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Check-in:</span>
                    <span>${data.checkIn}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Check-out:</span>
                    <span>${data.checkOut}</span>
                  </div>
                  <div class="detail-row">
                    <span class="detail-label">Total Price:</span>
                    <span>${data.totalPrice} ${data.currency}</span>
                  </div>
                </div>
                
                <p>We look forward to welcoming you!</p>
              </div>
              <div class="footer">
                <p>&copy; 2026 Hotel Booking. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    },
    [EMAIL_TEMPLATES.PAYMENT_SUCCESS]: {
      subject: `Payment Successful - ${data.bookingReference}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #28a745; padding: 20px; color: white; text-align: center; border-radius: 5px; }
              .amount { font-size: 32px; font-weight: bold; color: #28a745; text-align: center; margin: 20px 0; }
              .footer { background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Payment Successful</h1>
              </div>
              <div style="padding: 20px 0;">
                <p>Hello ${data.guestName},</p>
                <p>Your payment has been processed successfully.</p>
                <div class="amount">${data.amount} ${data.currency}</div>
                <p><strong>Booking Reference:</strong> ${data.bookingReference}</p>
                <p><strong>Transaction ID:</strong> ${data.transactionId}</p>
                <p>Your booking is now confirmed. Check your email for booking details.</p>
              </div>
              <div class="footer">
                <p>&copy; 2026 Hotel Booking. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    },
    [EMAIL_TEMPLATES.PAYMENT_FAILURE]: {
      subject: `Payment Failed - ${data.bookingReference}`,
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #dc3545; padding: 20px; color: white; text-align: center; border-radius: 5px; }
              .error-message { background-color: #fff3cd; padding: 15px; border-left: 4px solid #dc3545; margin: 20px 0; }
              .button { 
                display: inline-block; 
                padding: 12px 30px; 
                background-color: #007bff; 
                color: white; 
                text-decoration: none; 
                border-radius: 5px; 
                margin: 20px 0;
              }
              .footer { background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Payment Failed</h1>
              </div>
              <div style="padding: 20px 0;">
                <p>Hello ${data.guestName},</p>
                <p>Unfortunately, your payment could not be processed.</p>
                <div class="error-message">
                  <strong>Error:</strong> ${data.reason}
                </div>
                <p>Please try again or contact our support team for assistance.</p>
                <p><strong>Booking Reference:</strong> ${data.bookingReference}</p>
              </div>
              <div class="footer">
                <p>&copy; 2026 Hotel Booking. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    },
    [EMAIL_TEMPLATES.PASSWORD_RESET]: {
      subject: "Reset Your Password",
      html: `
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <style>
              body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
              .container { max-width: 600px; margin: 0 auto; padding: 20px; }
              .header { background-color: #f8f9fa; padding: 20px; text-align: center; border-radius: 5px; }
              .content { padding: 20px 0; }
              .button { 
              display: inline-block; 
                padding: 12px 30px; 
                background-color: #ff9800; 
                color: white; 
                text-decoration: none; 
                border-radius: 5px; 
                margin: 20px 0;
              }
              .footer { background-color: #f8f9fa; padding: 15px; text-align: center; font-size: 12px; color: #666; }
              .warning { color: #dc3545; font-size: 12px; margin-top: 10px; }
            </style>
          </head>
          <body>
            <div class="container">
              <div class="header">
                <h1>Password Reset Request</h1>
              </div>
              <div class="content">
                <p>Hello ${data.firstName},</p>
                <p>We received a request to reset your password. Click the button below to reset it:</p>
                <a href="${data.resetLink}" class="button">Reset Password</a>
                <p>Or copy and paste this link in your browser:</p>
                <p style="word-break: break-all; background-color: #f8f9fa; padding: 10px; border-radius: 5px;">
                  ${data.resetLink}
                </p>
                <p class="warning">This link will expire in 1 hour. If you didn't request a password reset, please ignore this email or contact support immediately.</p>
              </div>
              <div class="footer">
                <p>&copy; 2026 Hotel Booking. All rights reserved.</p>
              </div>
            </div>
          </body>
        </html>
      `,
    },
  };

  return templates[templateType] || null;
};

const sendEmail = async (email, templateType, data) => {
  try {
    if (!email || !templateType || !data) {
      throw new ApiError(400, "Email, template type, and data are required");
    }

    const template = getEmailTemplate(templateType, data);
    if (!template) {
      throw new ApiError(400, "Invalid email template type");
    }

    const response = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || "noreply@hotelbooking.com",
      to: email,
      subject: template.subject,
      html: template.html,
    });

    if (response.error) {
      console.error("Resend email error:", response.error);
      throw new ApiError(500, "Failed to send email");
    }

    return response;
  } catch (error) {
    console.error("Email service error:", error);
    if (error instanceof ApiError) {
      throw error;
    }
    throw new ApiError(500, "Email service unavailable");
  }
};

export { sendEmail, EMAIL_TEMPLATES };
