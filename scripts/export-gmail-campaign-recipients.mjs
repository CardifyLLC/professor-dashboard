import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

function loadEnv(file) {
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2];
    if (value.trimStart().startsWith("{")) {
      while (index + 1 < lines.length) {
        try {
          JSON.parse(value);
          break;
        } catch {
          value += `\n${lines[++index]}`;
        }
      }
    }
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

loadEnv(path.join(root, ".env"));

const rawCredentials = process.env.GMAIL_SERVICE_ACCOUNT_JSON;
const delegatedUser = process.env.GMAIL_SENDER_EMAIL;
const gmailScope = process.env.GMAIL_SCOPE || "https://www.googleapis.com/auth/gmail.readonly";
if (!rawCredentials || !delegatedUser) throw new Error("Missing Gmail credentials or sender in .env");

let credentials;
try {
  credentials = JSON.parse(rawCredentials);
} catch {
  credentials = JSON.parse(rawCredentials.replace(/\\n/g, "\n"));
}

console.log(JSON.stringify({
  serviceAccount: credentials.client_email,
  clientId: credentials.client_id,
  delegatedUser,
  requestedScope: gmailScope,
}, null, 2));

const encode = (value) => Buffer.from(value).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const jwtHeader = encode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
const jwtClaim = encode(JSON.stringify({
  iss: credentials.client_email,
  sub: delegatedUser,
  scope: gmailScope,
  aud: "https://oauth2.googleapis.com/token",
  iat: now,
  exp: now + 3600,
}));
const unsignedJwt = `${jwtHeader}.${jwtClaim}`;
const signature = crypto.sign("RSA-SHA256", Buffer.from(unsignedJwt), credentials.private_key).toString("base64url");

const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    assertion: `${unsignedJwt}.${signature}`,
  }),
});
if (!tokenResponse.ok) throw new Error(`Google token request failed (${tokenResponse.status}): ${await tokenResponse.text()}`);
const { access_token: accessToken } = await tokenResponse.json();

const query = process.argv.slice(2).join(" ") || 'in:sent after:2026/09/01 before:2026/09/04 "HUGE TCGPLAYTEST UPDATE"';
const api = "https://gmail.googleapis.com/gmail/v1/users/me";
const auth = { authorization: `Bearer ${accessToken}` };
const messages = [];
let pageToken;
do {
  const url = new URL(`${api}/messages`);
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "500");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const response = await fetch(url, { headers: auth });
  if (!response.ok) throw new Error(`Gmail search failed (${response.status}): ${await response.text()}`);
  const page = await response.json();
  messages.push(...(page.messages ?? []));
  pageToken = page.nextPageToken;
} while (pageToken);

const rows = [];
for (let index = 0; index < messages.length; index += 20) {
  const batch = messages.slice(index, index + 20);
  const details = await Promise.all(batch.map(async ({ id }) => {
    const url = new URL(`${api}/messages/${id}`);
    url.searchParams.set("format", "metadata");
    for (const header of ["To", "Subject", "Date"]) url.searchParams.append("metadataHeaders", header);
    const response = await fetch(url, { headers: auth });
    if (!response.ok) throw new Error(`Gmail message lookup failed (${response.status}) for ${id}`);
    return response.json();
  }));
  for (const message of details) {
    const headers = Object.fromEntries((message.payload?.headers ?? []).map(({ name, value }) => [name.toLowerCase(), value]));
    const recipients = (headers.to ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) ?? [];
    for (const email of recipients) rows.push({ email: email.toLowerCase(), subject: headers.subject ?? "", date: headers.date ?? "", messageId: message.id });
  }
}

const unique = [...new Map(rows.map((row) => [row.email, row])).values()];
const csvEscape = (value) => `"${String(value).replaceAll('"', '""')}"`;
const output = path.join(root, `gmail-campaign-recipients-${new Date().toISOString().slice(0, 10)}.csv`);
fs.writeFileSync(output, ["email,subject,date,message_id", ...unique.map((row) => [row.email, row.subject, row.date, row.messageId].map(csvEscape).join(","))].join("\n"));
console.log(JSON.stringify({ query, matchedMessages: messages.length, uniqueRecipients: unique.length, output }, null, 2));
