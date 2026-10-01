# Jewellery CRM: invoices, inventory, loyalty & WhatsApp retention

This layer turns the CRM into a store system for a gold / silver
jewellery business that bills in **Vasy ERP**:

- **Invoices**: imported from Vasy (CSV / Excel or the API) or entered
  by hand. Each line keeps the **gold / silver rate per gram the
  customer was billed at**.
- **Inventory**: gold and silver articles by tag / SKU, with gross,
  stone and net weight, making charge, priority and status, plus
  **daily metal rates**.
- **Loyalty points**:
  - **Earning:** 1 point per ₹100 of the invoice total **excluding GST**
    (making charges count).
  - **Value:** each point is worth **₹1.5 for the first month**, then
    **₹1** until it **expires 3 months after the purchase**.
  - **Redemption:** the oldest points are used first.
  - Every number above can be changed in **Loyalty → Settings**.
- **Automatic WhatsApps:**

  | When                                      | Message                                                                  |
  | ----------------------------------------- | ------------------------------------------------------------------------ |
  | Next morning after a purchase (10:00 IST) | Thank-you + Google review link + points earned, **invoice PDF attached** |
  | 30, 7 and 1 days before points expire     | Points-expiry reminder; skipped if the points were already used          |
  | On the birthday / anniversary (10:00 IST) | Wish + invitation to collect a surprise gift (bonus points optional)     |

- **WhatsApp self-service**: a customer who texts `points` / `loyalty`
  / `balance` gets their lifetime points, active points and their ₹
  value today, and when those points expire. Texting `orders` /
  `purchase` returns their last 5 invoices too.

## 1. Set up

1. **Apply the migration** `supabase/migrations/037_jewellery_loyalty.sql`.
   - With the Supabase CLI: `supabase db push`.
   - Without it: paste the file into the SQL editor.
   - It creates the tables, the FIFO redemption function and a
     **private** `invoices` storage bucket for PDFs.
2. **Set the cron secret.** If it isn't set already, set
   `AUTOMATION_CRON_SECRET` (for example with `openssl rand -hex 32`).
3. **Schedule the loyalty cron** every 15 minutes, using any scheduler
   (cron-job.org, GitHub Actions, a server crontab or Vercel Cron):

   ```bash
   curl -fsS -H "x-cron-secret: $AUTOMATION_CRON_SECRET" \
     https://your-crm.example.com/api/loyalty/cron
   ```

   Each tick does two things:
   - credits birthday / anniversary bonuses once a day, at or after the
     send hour
   - sends all due messages

4. **Create the WhatsApp templates** (section 3) in
   **Settings → Templates**, and wait for Meta to approve them.
5. **Open Loyalty → Settings** and fill in:
   - store name and Google review link
   - points rules
   - birthday / anniversary bonus points
   - which template is used for each message, and which value goes into
     each `{{n}}`

   Click **Save**. The WhatsApp auto-replies start after this first
   save.

## 2. Getting invoices in

### CSV / Excel (Vasy export)

**Invoices → Import** accepts `.csv` or `.xlsx`. Use **one row per
invoice line**: rows that share an invoice number are combined.
Columns are matched automatically, and you can fix any match before
importing. These headers are recognised:

| Field                                       | Recognised headers (examples)                            |
| ------------------------------------------- | -------------------------------------------------------- |
| Invoice no. *                               | Invoice No, Bill No, Voucher No                          |
| Mobile *                                    | Mobile, Mobile No, Phone, Contact No                     |
| Invoice date                                | Invoice Date, Bill Date, Date (DD/MM/YYYY or YYYY-MM-DD) |
| Customer name                               | Customer Name, Party Name                                |
| Customer code, Email, Birthday, Anniversary | Customer Code, Email, DOB, Anniversary                   |
| Tag / SKU                                   | Tag No, SKU, Item Code, Barcode                          |
| Item                                        | Item Name, Description, Particulars                      |
| Metal, Purity                               | Metal; Purity, Karat, Touch                              |
| Net wt, Rate / g, Making                    | Net Wt, Rate, Gold Rate, Making, MC                      |
| Amount (line), Discount, GST, Total         | Amount; Discount; GST; Total, Bill Total, Grand Total    |

Other details:

- **Phone numbers:** 10-digit numbers get `+91`.
- **Points:** credited on the invoice **Total minus GST** (making
  charges count). Map your GST column so it can be left out. Without a
  total column, the total is worked out as lines − discount + GST.
- **Re-importing:** importing the same file again is safe. Invoices
  that already exist are skipped.
- **Old invoices:** the feedback WhatsApp is only queued for invoices
  from the last 3 days, so importing old history doesn't message
  everyone. Old invoices still earn points, dated from the purchase,
  so already-expired points stay expired.
- **Sold stock:** a tag that matches an inventory item marks that item
  as sold.

**Inventory → Import** and **Loyalty → Import birthdays** work the same
way, for article sheets and for customer birthday / anniversary lists.

### API (Vasy or any system that can POST JSON)

1. Create a key in **Settings → API keys** with the `invoices:write`
   scope.
2. Call `POST /api/v1/invoices`.

To attach the invoice PDF, send it as `pdf_base64` (base64-encoded
PDF). See [public-api.md](./public-api.md#post-apiv1invoices) for the
full payload. A built-in Vasy connector (`src/lib/integrations/vasy`)
is stubbed and will be wired up once Vasy API access is available.

### By hand

Use **Invoices → New invoice**. A line's amount fills in from
weight × rate + making. You can attach the PDF afterwards from the
invoice page.

## 3. WhatsApp templates

Meta only allows free-form messages within 24 hours of the customer's
last message. Retention messages go out later than that, so each one
needs an **approved template**. Below are suggested wordings. You can
change the wording freely, as long as the **Values** list in Loyalty →
Settings matches the order of your `{{n}}` variables.

Values you can use: `name`, `store_name`, `review_url`, `invoice_no`,
`invoice_total`, `invoice_date`, `points_earned`, `active_points`,
`active_value`, `lifetime_points`, `expiring_points`, `expiry_date`,
`days_left`, `bonus_points`.

**Post-purchase thank-you**: category _Utility_, **Document header**
(the invoice PDF goes there). Values: `name, points_earned, active_points, review_url`.

> Hi {{1}}, thank you for shopping with us! 💛 Your invoice is attached.
> You earned {{2}} loyalty points on this purchase — you now have {{3}} active points.
> We'd love your feedback: {{4}}

Also create the same template **without** a header and map it to
_Post-purchase thank-you (no PDF)_. It is used when an invoice has no
PDF attached.

**Points expiry reminder**: _Utility_. Values: `name, expiring_points, expiry_date, active_value`.

> Hi {{1}}, a reminder that {{2}} of your loyalty points expire on {{3}}.
> Your points are worth {{4}} today — visit us to redeem them before they expire! ✨

**Birthday wish**: _Marketing_. Values: `name`.

> Happy Birthday {{1}}! 🎂 A surprise gift is waiting for you at the store.
> Visit us to collect it! 🎁

**Anniversary wish**: _Marketing_. Values: `name`.

> Happy Anniversary {{1}}! 💍 A surprise gift is waiting for you at the store
> to celebrate your special day. 🎁

Birthday / anniversary bonus points are off (0). To give points later,
set them in Loyalty → Settings and add `bonus_points` to the template.

## 4. Day to day

- **Redeem points:** use **Redeem points** on an invoice or in the
  contact's **Loyalty** tab. The dialog shows the ₹ discount and how
  much comes from ₹1.5 points and how much from ₹1 points. Oldest
  points are used first, in a single database transaction.
- **Manual bonus points** (admins only): **Contact → Loyalty → Add
  bonus points**, with a reason. These follow the same 1-month /
  3-month rules from the day they're added.
- **Loyalty → WhatsApp log** shows every queued, sent, skipped and
  failed message:
  - **Retry** resends a failed or skipped message.
  - **Cancel** stops a scheduled one.
  - Sends that fail are retried twice, 30 minutes apart.
- **Opt-out:** to stop automatic messages for one customer, set **No
  automatic loyalty messages** in their Loyalty tab.
- Every automatic message also appears in the customer's inbox
  conversation.

## 5. How the auto-replies decide

- **Plain text only:** the reply only runs for plain text messages
  that no active Flow has taken.
- **Short messages only:** the message must be **5 words or fewer** and
  contain one of the keywords as a whole word. So "points?" or "my
  orders" get an instant answer, but "I want to order a gold chain for
  my wife" still reaches your team.
- **No double answers:** when the auto-reply answers, keyword
  automations and the AI auto-reply skip that message.
- **Unknown numbers:** customers with no purchases get a polite "we
  couldn't find purchases for this number" reply.
