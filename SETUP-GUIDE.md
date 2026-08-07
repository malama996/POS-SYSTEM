# ShopPOS v2.0 — Setup Guide
**By ZhenchStacks | Built for Zambian shops**

---

## What's Fixed & New in v2.0

| Issue | Fixed |
|---|---|
| Complete Sale button shadowed by nav | ✅ Cart is its own scrollable column |
| Bar chart not aligned | ✅ Proper flex bar chart |
| WhatsApp field not clear | ✅ Labelled "WhatsApp: 260…" with flag |
| PIN background not full screen | ✅ `position:fixed;inset:0` covers all |
| SW 404 error | ✅ SW only caches local files, no 404 |
| Manual price entry | ✅ Manual item row in cart |
| Product icons | ✅ Emoji icons per category, auto-assigned |
| Time accuracy | ✅ Uses device local time |
| Mobile responsive POS | ✅ Tab switcher: Products ↔ Cart |
| Print receipt | ✅ Print button uses `@media print` |
| Product QR codes | ✅ QR label generator per product |
| Anti-manipulation | ✅ Audit log, staff disable, soft-delete |
| Shop isolation | ✅ Unique shopId per shop |
| Per-cashier records | ✅ Every sale tagged with cashier name |
| Data sync | ✅ Firebase + localStorage dual-layer |

---

## Files in this folder

```
shoppos/
├── index.html          ← The entire app
├── manifest.json       ← PWA installable config
├── sw.js               ← Service Worker (offline)
├── generate-icons.html ← Open to download app icons
├── firestore.rules     ← Firebase security rules
└── SETUP-GUIDE.md      ← This file
```

---

## STEP 1 — Generate Icons

1. Open `generate-icons.html` in Chrome
2. Download `icon-192.png` and `icon-512.png`
3. Create a folder called `icons/` inside `shoppos/`
4. Put both PNG files inside `icons/`

---

## STEP 2 — Host on Netlify (Free, 2 minutes)

1. Go to **https://netlify.com** → sign up free
2. Click **Add new site → Deploy manually**
3. Drag your entire `shoppos/` folder onto the page
4. You get a URL like `https://yourshop.netlify.app`
5. Done — your app is live!

> **Why not test locally?** The Service Worker requires HTTPS.
> Netlify gives you HTTPS for free. Alternatively use `npx serve .`

---

## STEP 3 — Install on Phone

### Android (Chrome)
1. Open your Netlify URL in Chrome
2. Tap the menu (⋮) → **Add to Home Screen**
3. OR wait for the install banner to appear at the bottom
4. The app icon appears on your home screen — works offline!

### iPhone (Safari only)
1. Open Safari → go to your Netlify URL
2. Tap the Share button (box with arrow)
3. Scroll down → **Add to Home Screen** → Add
4. Works offline after first load

---

## STEP 4 — Firebase Cloud Backup (Optional but Recommended)

### Why Firebase?
- Data safe if phone is lost/broken/reset
- Multiple devices see the same stock and sales
- Free up to 1GB / 50,000 reads per day

### Setup
1. Go to **https://console.firebase.google.com**
2. **Add project** → name it "ShopPOS" → Create
3. **Firestore Database** → Create → choose a production location → Done
4. **Authentication** → Sign-in method → enable **Anonymous** for the initial offline-first setup. For real multi-device shops, also enable **Email/Password** and migrate owners to named accounts before rollout.
4. **Project Settings** (gear icon) → **Your apps** → click `</>` (Web)
5. Register app as "ShopPOS" → copy the `firebaseConfig` object

6. Open `index.html` in Notepad/TextEdit
7. Find this near the top of the `<script>` tag:
```js
const FB={/*apiKey:'',authDomain:'',...*/};
```
8. Replace with your actual config:
```js
const FB={
  apiKey: "AIzaSy...",
  authDomain: "shoppos-xxx.firebaseapp.com",
  projectId: "shoppos-xxx",
  storageBucket: "shoppos-xxx.appspot.com",
  messagingSenderId: "123456",
  appId: "1:123456:web:abc123"
};
```
9. Save and re-upload to Netlify (drag folder again)
10. Deploy the included `firestore.rules` before using cloud sync. The sync dot in the top bar turns green ✓ only after Firebase Authentication succeeds.

> **Never deploy the old `allow read, write: if true` rule.** The included rules require a signed-in user, isolate data by shop membership, and make cloud sales append-only.

---

## STEP 5 — First-Time Setup In The App

1. Open app → enter PIN: **1234** (default)
2. **More** tab → **Business Info & ZRA Details** → Edit:
   - Shop name, address, phone number
   - If VAT registered: enter TPIN, Branch ID, MRC No., SDC ID
   - Set tax type (VAT / TOT / None)
   - Customize receipt footer message
3. **More** → **Staff & PINs** → Add Mum, Dad, siblings with their own PINs
4. **More** → **Change Owner PIN** → Set your secure PIN
5. **Stock** → Edit the pre-loaded products to match your actual stock and prices
6. You're ready to sell!

---

## Daily Workflow

### Selling (Sell tab)
- Tap a product → adds to cart
- Swipe to **Cart** tab on mobile
- Enter customer name and WhatsApp number (for receipt)
- Add manual items if needed (any product not in the system)
- Choose Cash or Mobile Money
- Enter cash given → app shows change automatically
- Tap **Complete Sale** → receipt appears
- Tap **WhatsApp** → PDF sent directly to customer's WhatsApp

### End of Day
- **More** → **WhatsApp Daily Report** → Send Now
- Report goes to your phone with totals, cash vs mobile, stock alerts

### Restocking
- **Stock** tab → tap **Edit** on any product → update quantity
- Log the supplier purchase: **More** → **Supplier Orders**

---

## ZRA Smart Invoice Fields Explained

| Field | What It Is | Where to Get It |
|---|---|---|
| TPIN | Your 10-digit taxpayer number | ZRA registration letter |
| Branch ID | 3-digit branch code | ZRA portal |
| MRC No. | Machine Register Code | ZRA when you register your device |
| SDC ID | Sales Device Controller ID | ZRA / your fiscal device |
| Fiscal Signature | Auto-generated per sale | Calculated by ShopPOS |
| ZRA Invoice No. | Format: YYYYMMDD-XXXXXX | Auto-generated |
| QR Code | Links to ZRA verification portal | Auto-generated |

> If you are **not VAT registered**, leave TPIN blank. The receipt shows
> "SALES RECEIPT" instead of "ZRA TAX INVOICE" — fully legal.

---

## Security Features

- **PIN lock** — nobody enters without a PIN
- **Staff PINs** — each person has their own PIN, tracked separately
- **Audit log** — every login, sale, edit, deletion is logged permanently
- **Staff disable** — remove access without deleting their sales history
- **No price manipulation** — prices come from product database; manual items are flagged
- **Shop isolation** — each shop has a unique `shopId`; no data crosses between shops
- **Immutable sales** — completed sales cannot be edited, only voided by admin

## Production rollout checklist

Before using cloud backup with live business data:

- Enable Firebase Authentication and deploy `firestore.rules`.
- Use named owner accounts (Email/Password or SSO), not anonymous accounts, for shops that use more than one device.
- Provision staff membership through a trusted server/Admin SDK; do not grant database access directly from a public client.
- Enable scheduled Firestore exports/backups in a separate Google Cloud project or bucket.
- Configure uptime checks, error alerts, and budget alerts in Google Cloud Monitoring.
- Deploy from source control through CI/CD; keep Firebase credentials in repository secrets, never in `index.html`.

---

## Product QR Labels

1. **Stock** tab → any product → tap **QR**
2. A scannable label appears with product name, price, and your shop name
3. Tap **Print Label** → prints to any printer
4. Stick label on the product
5. When cashier scans it, product is added to cart instantly
6. Works with any USB or Bluetooth barcode scanner

---

## Keyboard Shortcuts (Tablet/Computer)

| Key | Action |
|---|---|
| `1` | Sell screen |
| `2` | Stock screen |
| `3` | Reports |
| `4` | Credit |
| `5` | More / Settings |
| `Esc` | Close any modal |

---

## Selling This to Other Shops

**Pricing ideas:**
- Setup fee: K1,500 – K2,500 (install + training + Firebase setup)
- Monthly support: K100 – K200/month
- 10 shops = K1,000–2,000/month passive income

**Target customers:**
- Bottle stores, tuck shops, spaza shops
- General dealers, butcheries, pharmacies
- Salons (product sales), hardware shops

**Sales pitch:**
> *"No paper receipts. No lost records. No wondering what your stock is.
> K150 a month and your shop runs like a big company — with ZRA-ready invoices."*

---

*ShopPOS v2.0 — Software by ZhenchStacks*
*Built for Zambia. Ready for Africa.*
