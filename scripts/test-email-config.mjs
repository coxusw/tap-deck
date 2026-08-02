import path from "node:path";
import dotenv from "dotenv";
import nodemailer from "nodemailer";

dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const required = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"];
const missing = required.filter((name) => !process.env[name]);

if (missing.length) {
  console.error(`Missing SMTP env vars: ${missing.join(", ")}`);
  process.exit(1);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: String(process.env.SMTP_SECURE || "true") !== "false",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

await transporter.verify();
console.log("SMTP login verified.");
