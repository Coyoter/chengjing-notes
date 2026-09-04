let runtime = {};
try {
  runtime = require("./google-oauth-runtime.cjs");
} catch (error) {
  if (error?.code !== "MODULE_NOT_FOUND") throw error;
}

module.exports = {
  // Desktop OAuth client IDs are public identifiers. The production value is
  // inserted after the Google Cloud project is created; local QA can override it.
  clientId: String(process.env.CHENGJING_GOOGLE_OAUTH_CLIENT_ID || "594584088822-b0d7nn1cdlshaqqgfiijo2lkep87n713.apps.googleusercontent.com").trim(),
  clientSecret: String(process.env.CHENGJING_GOOGLE_OAUTH_CLIENT_SECRET || runtime.clientSecret || "").trim(),
};
