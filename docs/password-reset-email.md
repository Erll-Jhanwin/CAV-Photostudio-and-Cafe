# Password Reset Email On Render

Render free web services block outbound SMTP ports, including Gmail port 587. Use the Resend HTTPS API for deployed password reset emails.

1. Create a Resend account, add and verify a sending domain, then create an API key.
2. In the Render backend service environment, set:

   ```env
   EMAIL_PROVIDER=resend
   RESEND_API_KEY=re_your_api_key
   DEFAULT_FROM_EMAIL=CAV Photo Studio & Cafe <no-reply@your-verified-domain.com>
   EMAIL_TIMEOUT=20
   ```

3. Save the variables and deploy the latest commit.

For local SMTP development, keep `EMAIL_PROVIDER=smtp` and configure the standard `EMAIL_*` variables. Do not put API keys or app passwords in source files.
