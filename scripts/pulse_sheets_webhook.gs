/**
 * Pulse account log → Google Sheet
 *
 * 1. Create a new Google Sheet (e.g. "Pulse Accounts").
 * 2. Extensions → Apps Script → paste this file → Save.
 * 3. Deploy → New deployment → Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy the Web app URL into data/pulse-google-config.json as sheets_webhook_url.
 *
 * Columns written on each sign-in:
 * timestamp | event | google_sub | email | name | picture_url | sign_in_count
 */

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "timestamp",
      "event",
      "google_sub",
      "email",
      "name",
      "picture_url",
      "sign_in_count",
    ]);
  }
  var body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: "Invalid JSON" })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  sheet.appendRow([
    body.timestamp || "",
    body.event || "",
    body.google_sub || "",
    body.email || "",
    body.name || "",
    body.picture_url || "",
    body.sign_in_count || "",
  ]);
  return ContentService.createTextOutput(
    JSON.stringify({ ok: true })
  ).setMimeType(ContentService.MimeType.JSON);
}