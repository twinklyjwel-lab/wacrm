# Going live

How to take the Twinkly Jewels CRM from this repository to a running
system: database (Supabase), hosting (Vercel), WhatsApp Cloud API
(Meta), loyalty templates, and the 15-minute loyalty cron. Steps 1–2
take about 20 minutes. Step 3 depends on Meta's business verification,
which usually takes 1–3 days.

### Step 1: Create the database (Supabase), about 10 min
1. Go to supabase.com → sign up → **New project**.
   - Name: `twinkly-crm`.
   - Region: **Mumbai (ap-south-1)**.
   - Set a strong database password and save it.
2. When the project is ready, open **SQL Editor** → **New query**. Paste the whole of `supabase/setup_all.sql` from the CRM repo → **Run**. It should finish with "Success".
3. Open **Project Settings → API**. Copy these into a note:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY` (secret; never share it)
4. Open **Authentication → URL Configuration**. Fill these in after Step 2, once you have the Vercel address:
   - **Site URL** = your Vercel URL
   - **Redirect URLs**: add `https://<your-vercel-url>/**`

### Step 2: Host the app (Vercel), about 10 min
1. Go to vercel.com → **Sign up with GitHub** → **Add New → Project** → import **twinklyjwel-lab/CRM**. Framework: Next.js is detected automatically.
2. Before clicking Deploy, open **Environment Variables** and add:

   | Name | Value |
   |---|---|
   | `NEXT_PUBLIC_SUPABASE_URL` | from Step 1.3 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | from Step 1.3 |
   | `SUPABASE_SERVICE_ROLE_KEY` | from Step 1.3 |
   | `ENCRYPTION_KEY` | 64 random hex characters. Generate one at https://www.random.org/strings/ (or ask me), and never change it later |
   | `AUTOMATION_CRON_SECRET` | any long random string (say 40 characters); it protects the cron |
   | `META_APP_SECRET` | from Step 3.4; type `pending` for now and update it later |
   | `NEXT_PUBLIC_SITE_URL` | your Vercel URL, e.g. `https://twinkly-crm.vercel.app`; update it after the first deploy |
   | `NEXT_PUBLIC_APP_LOCALE` | `en` |
3. **Deploy**. Open the URL → **Sign up** with your email. The first account becomes the **owner**.
4. Go back to Supabase Step 1.4 and set the Site URL and Redirect URLs. In Vercel, set `NEXT_PUBLIC_SITE_URL` correctly and **Redeploy**.

### Step 3: WhatsApp Cloud API (Meta), about 1–3 days because of verification
**About your current number:** a number that is active in the WhatsApp Business phone app can't be used with the Cloud API this CRM uses. Pick one:
- **(a) Recommended:** get a **new SIM/number** for the CRM, and keep the old number on the phone app for now.
- **(b)** Move the existing number. In the phone app, go to **Settings → Account → Delete account**. This loses its chat history in the app. Then register the number below.

Steps:
1. Go to business.facebook.com → create or choose the **Twinkly Jewels** business. Under **Business info**, add the legal name, address and website.
2. Go to developers.facebook.com → **My Apps → Create App** → choose **Business** → link it to that business → add the **WhatsApp** product.
3. In **WhatsApp → API Setup** → **Add phone number**. Enter the display name "Twinkly Jewels", choose the category, then verify the number by SMS or call.
4. In **App settings → Basic**, copy **App Secret** into Vercel as `META_APP_SECRET`, then redeploy. Also note the **App ID**.
5. Create a permanent token:
   - Go to **Business settings → Users → System users → Add** (role Admin).
   - **Assign assets**: your app with Full control, and your WhatsApp account.
   - **Generate token** with the permissions `whatsapp_business_messaging` and `whatsapp_business_management`. Copy it.
6. In the CRM, open **Settings → WhatsApp**. Fill in:
   - **Phone Number ID** and **WhatsApp Business Account ID** (both shown in API Setup)
   - the token
   - a **Verify token** you make up (any word, e.g. `twinkly2026`)

   Then click **Save**.
7. Back in Meta, go to **WhatsApp → Configuration → Webhook → Edit**:
   - Callback URL `https://<your-vercel-url>/api/whatsapp/webhook`
   - Verify token: the same word as step 6

   Click **Verify and save**. Then **subscribe** to the `messages` field, and also `message_template_status_update`.
8. Go to **Business settings → Security Center → Start verification**. Upload GST/business documents. Until this passes, Meta limits messaging (about 250 customers/day).
9. Add a payment method in **WhatsApp Manager → Payment settings**. Templates sent to customers are billed per message by Meta.
10. Test: message the business number from your own phone. It should appear in the CRM **Inbox**.

### Step 4: Create the 5 WhatsApp templates, 1–2 days for approval
In the CRM, go to **Settings → Templates → New template**. The wording is in `docs/loyalty.md` §3.

| Name | Category | Header | Body variables |
|---|---|---|---|
| `purchase_thank_you` | Utility | **Document** (upload a sample invoice PDF) | name, points earned, active points, review link |
| `purchase_thank_you_nopdf` | Utility | none | same 4 |
| `points_expiry_reminder` | Utility | none | name, expiring points, expiry date, ₹ value |
| `birthday_wish` | Marketing | none | name |
| `anniversary_wish` | Marketing | none | name |

Click **Submit to Meta**. Approval usually takes minutes to 24 hours. Rejections usually mean the wording sounds promotional inside a Utility template; tweak it and resubmit.

### Step 5: Set up loyalty in the CRM, about 10 min
Go to **Loyalty → Settings** and fill in:
- store name
- **Google review link**: Google Business Profile → **Ask for reviews** → copy the link
- points: 1 per ₹100, ₹1.5 for 1 month, ₹1 until 3 months, GST 3% (the defaults)
- birthday/anniversary points: 0
- send hour: 10
- template for each message, and its values in order:
  - Thank-you: `name, points_earned, active_points, review_url`
  - Expiry: `name, expiring_points, expiry_date, active_value`
  - Wishes: `name`

Then **Save**. This also switches on the "points" / "orders" WhatsApp auto-replies.

### Step 6: The 15-minute loyalty cron (cron-job.org, free), about 5 min
Vercel's free plan only allows a cron once per day, so use cron-job.org:
1. Sign up at cron-job.org → **Create cronjob**.
   - URL `https://<your-vercel-url>/api/loyalty/cron`
   - Schedule: **every 15 minutes**
2. **Advanced → Headers → Add**: `x-cron-secret` = your `AUTOMATION_CRON_SECRET` value.
3. Save → **Test run**. It should return `200` with `{"occasions":{},"messages":{...}}`. `401` means the secret doesn't match.
4. Optionally, create a second job the same way for `/api/automations/cron`, used by automation "wait" steps.

### Step 7: Load your data
1. **Loyalty → Import birthdays**: your customer list (name + mobile, plus birthday/anniversary if you have them). Do this **first**, because the Vasy sales export has no mobile numbers and invoices are matched by name.
2. **Inventory → Metal rates**: today's gold and silver rates. Then **Inventory → Import** for stock, if you have a sheet.
3. **Invoices → Import**: the Vasy "Sales All Data" export. Check the result list; any "no customer named …" rows need that customer added, then re-import.

### Step 8: Test end to end
1. Create a test invoice for your own number. Points appear in **Contacts → you → Loyalty**.
2. Send "points" from your phone to the business number. You should get an instant reply with your balance.
3. Next morning after 10:00, the thank-you message with the PDF arrives. **Loyalty → WhatsApp log** shows sent, skipped or failed messages with the reason.

### Optional: connect Claude to the CRM
**Settings → API keys** → create a key with the jewellery scopes, then follow `mcp-server/README.md` → "Jewellery CRM build".
