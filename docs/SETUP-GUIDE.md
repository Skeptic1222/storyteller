# Storyteller - Authentication & Payment Setup Guide

Quick reference for setting up Google OAuth and PayPal for the Storyteller app.

---

## Part 1: Google OAuth Setup

### Step 1: Go to Google Cloud Console
1. Visit https://console.cloud.google.com/
2. Sign in with your Google account (sop1973@gmail.com)
3. Select an existing project or create a new one

### Step 2: Enable Required Google APIs
1. Go to **APIs & Services** > **Library**
2. Ensure **Google Identity Services** is available for OAuth (consent screen + OAuth client)
3. Enable **People API** only if your app reads profile/contact fields beyond standard OpenID claims

### Step 3: Configure OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**
2. Choose **External** user type
3. Fill in required fields:
   - **App name**: Storyteller
   - **User support email**: sop1973@gmail.com
   - **App logo**: (optional)
   - **Application home page**: https://ay-i-t.com/storyteller
   - **Privacy policy**: https://ay-i-t.com/storyteller/privacy (create this)
   - **Terms of service**: https://ay-i-t.com/storyteller/terms (create this)
4. Add scopes:
   - `email`
   - `profile`
   - `openid`
5. Add test users (during development): sop1973@gmail.com
6. Save and continue

### Step 4: Create OAuth 2.0 Credentials
1. Go to **APIs & Services** > **Credentials**
2. Click **Create Credentials** > **OAuth client ID**
3. Choose **Web application**
4. Name: "Storyteller Web Client"
5. **Authorized JavaScript origins**:
   ```
   https://ay-i-t.com
   http://localhost
   ```
6. **Authorized redirect URIs**:
   ```
   https://ay-i-t.com/storyteller/api/auth/google/callback
   http://localhost/storyteller/api/auth/google/callback
   ```
7. Click **Create**
8. **Copy the Client ID and Client Secret** - you'll need these

### Step 5: Add to Your .env File
```env
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
```

---

## Part 2: PayPal Setup

### Step 1: Create PayPal Developer Account
1. Go to https://developer.paypal.com/
2. Log in or sign up with your PayPal account
3. Go to **Dashboard** > **My Apps & Credentials**

### Step 2: Create REST API App (Sandbox First)
1. Under **Sandbox** tab, click **Create App**
2. Name: "Storyteller"
3. App Type: Merchant
4. Click **Create App**
5. **Copy the Client ID and Secret** for sandbox testing

### Step 3: Create Subscription Plans in Sandbox

You need to create subscription plans via the PayPal API. Here's how:

#### Option A: Use PayPal Dashboard
1. Go to https://www.sandbox.paypal.com/billing/plans
2. Log in with your sandbox business account
3. Create each plan manually

#### Option B: Use API (Recommended)
Create a script to set up plans. I'll need these credentials to help you:

```javascript
// Run this with Node.js after getting your credentials
const PAYPAL_CLIENT_ID = 'your-sandbox-client-id';
const PAYPAL_SECRET = 'your-sandbox-secret';

// I can help create this script once you have credentials
```

### Step 4: Create Webhook
1. In PayPal Developer Dashboard, go to **Webhooks**
2. Add webhook URL: `https://ay-i-t.com/storyteller/api/paypal/webhook`
3. Select events:
   - `BILLING.SUBSCRIPTION.CREATED`
   - `BILLING.SUBSCRIPTION.ACTIVATED`
   - `BILLING.SUBSCRIPTION.CANCELLED`
   - `BILLING.SUBSCRIPTION.SUSPENDED`
   - `BILLING.SUBSCRIPTION.PAYMENT.FAILED`
   - `PAYMENT.SALE.COMPLETED`
4. **Copy the Webhook ID**

### Step 5: Test with Sandbox
1. Use sandbox credentials during development
2. Create test accounts at https://developer.paypal.com/developer/accounts
3. Test the full subscription flow

### Step 6: Switch to Live
1. Create a new REST API app under **Live** tab
2. Repeat the plan creation with live credentials
3. Update webhook URL for production
4. Update .env with live credentials

### Add to Your .env File
```env
# Sandbox (for testing)
PAYPAL_CLIENT_ID=your-sandbox-client-id
PAYPAL_CLIENT_SECRET=your-sandbox-secret
PAYPAL_WEBHOOK_ID=your-sandbox-webhook-id
PAYPAL_MODE=sandbox

# These will be created via API or PayPal dashboard
PAYPAL_PLAN_ID_DREAMER=P-xxx
PAYPAL_PLAN_ID_STORYTELLER=P-xxx
PAYPAL_PLAN_ID_FAMILY=P-xxx
```

---

## Part 3: What to Give Claude Code

Once you have the credentials, provide Claude Code with:

### Environment Variables
```env
# Google OAuth
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxx

# PayPal (Sandbox for now)
PAYPAL_CLIENT_ID=xxxxx
PAYPAL_CLIENT_SECRET=xxxxx
PAYPAL_WEBHOOK_ID=xxxxx
PAYPAL_MODE=sandbox

# Admin Configuration
ADMIN_EMAILS=sop1973@gmail.com

# JWT Secret (generate a random string)
JWT_SECRET=your-random-jwt-secret-at-least-32-chars
```

### Implementation Request
Then ask Claude Code to:

1. **Create auth routes** (`/api/auth/google`, `/api/auth/google/callback`, `/api/auth/me`, `/api/auth/logout`)

2. **Create PayPal routes** (`/api/subscriptions/create`, `/api/webhooks/paypal`, `/api/subscriptions/cancel`)

3. **Add user profile component** with:
   - Google avatar in top-right
   - Dropdown menu with links
   - Admin badge if admin user

4. **Create admin panel** at `/admin` with:
   - User list
   - Subscription management
   - Usage statistics

5. **Add credit tracking** with:
   - Display remaining credits
   - Cost estimates before actions
   - Narration toggle per story

---

## Part 4: Quick PayPal Plan Creation Script

Once you have sandbox credentials, give me these values and I can help create the plans:

```
PAYPAL_CLIENT_ID: ?
PAYPAL_CLIENT_SECRET: ?
```

I'll then create a script that sets up:
- Dreamer Plan ($7.99/month, 7-day trial)
- Storyteller Plan ($14.99/month, 7-day trial)
- Family Plan ($24.99/month, 7-day trial)

And return the Plan IDs you'll need.

---

## Checklist

- [ ] Created Google Cloud project
- [ ] Configured OAuth consent screen
- [ ] Created OAuth credentials
- [ ] Got `GOOGLE_CLIENT_ID`
- [ ] Got `GOOGLE_CLIENT_SECRET`
- [ ] Created PayPal Developer account
- [ ] Created Sandbox REST API app
- [ ] Got `PAYPAL_CLIENT_ID` (sandbox)
- [ ] Got `PAYPAL_CLIENT_SECRET` (sandbox)
- [ ] Created webhook, got `PAYPAL_WEBHOOK_ID`
- [ ] Created subscription plans (or ready to create via API)
- [ ] Generated `JWT_SECRET`
- [ ] Added `ADMIN_EMAILS=sop1973@gmail.com`

---

*Once you have all credentials, share them with Claude Code (privately) and we can implement the full auth/payment system.*
