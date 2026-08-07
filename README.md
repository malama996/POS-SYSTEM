# ShopPOS

An offline-first point-of-sale web application for small shops and growing retail businesses. ShopPOS manages sales, inventory, staff PINs, restocking, customer credit, receipts, reports, and optional Firebase cloud backup.

Designed for mobile phones, tablets, and desktop browsers, with a focus on practical day-to-day shop operations in Zambia.

## Features

- Fast product sales with cash and mobile-money payment modes
- Automatic stock reduction when a sale is completed
- Out-of-stock protection and low-stock alerts
- Product catalogue with custom categories, units, and category icons
- Restocking workflow with quantity received, cost, supplier, note, cashier, and history
- Staff PIN sign-in and local role controls for owner, supervisor, and cashier
- Customer credit records and payment tracking
- Sales reports, cashier attribution, daily summaries, CSV export, and receipts
- QR labels, barcode support, receipt printing, PDF export, and WhatsApp sharing
- Progressive Web App (PWA) support for installable, offline-first use
- Optional Firebase Authentication and Firestore cloud backup

## Screens

| Area | Purpose |
| --- | --- |
| Sell | Add products, take payment, complete sales, and issue receipts. |
| Stock | Add/edit products, set category/unit/icon, scan, print labels, and restock. |
| Reports | Review sales, totals, cash/mobile-money split, and export CSV. |
| Credit | Record customer credit and mark balances paid. |
| More | Configure business details, staff, tax receipt details, suppliers, backup, and data actions. |

## Quick start

### 1. Run locally

Do not open `index.html` with `file://`. Start a local web server instead:

```powershell
npx serve . -l 3000
```

Open [http://localhost:3000](http://localhost:3000).

The first local Owner PIN is `1234`. Change it before real use.

### 2. Add real stock

1. Open **More → Data → Clear product catalogue** to remove demo products.
2. Open **Stock → Add Product**.
3. Enter product details, a category, unit, and category icon.
4. Use **Restock** whenever new stock arrives; it adds received quantity rather than replacing the current count.

### 3. Install as an app

Deploy the folder to an HTTPS host such as Netlify, open the site in Chrome or Safari, then use **Add to Home Screen** / **Install**.

## Firebase cloud backup

Firebase is optional. Without it, ShopPOS stores data locally in the browser and continues working offline.

To enable cloud backup:

1. Create a Firebase project and Firestore database.
2. Enable **Firebase Authentication → Anonymous** for initial testing.
3. Copy the Firebase web configuration into the `FB` object in `index.html`.
4. Deploy the included `firestore.rules` before allowing live cloud usage.
5. Add your hosting domain to Firebase Authentication’s authorized domains.

The Firebase web configuration is safe to include in a web application. Never place service-account keys, private keys, or admin credentials in this repository.

## Security notes

The included Firestore rules require authenticated access, use an owner ID and shop membership structure, and make cloud sales append-only.

Current local roles protect the user interface, but they are not a replacement for server-enforced authorization. Before offering shared, multi-device cloud access to paying shops, implement:

- Named user accounts (email/password or SSO)
- Trusted staff invitations and role assignment through an Admin SDK or Cloud Functions
- Server-side inventory transactions, voids, and audit retention
- Tenant isolation tests for every shop
- Managed backups, monitoring, error alerts, and CI/CD deployment

For the current version, use a separate Firebase project and deployment for each independent paying shop if cloud testing is required.

## Project structure

```text
shoppos/
├── index.html          # Application UI, local state, sales, stock, and Firebase client integration
├── sw.js               # Service worker and offline cache
├── manifest.json       # PWA metadata
├── firestore.rules     # Authenticated Firestore security rules
├── generate-icons.html # Utility for generating PWA icons
├── SETUP-GUIDE.md      # Detailed setup instructions
└── README.md           # This document
```

## Operational recommendations

- Change the Owner PIN immediately during setup.
- Give every cashier a unique PIN; disable access when staff leave.
- Use **Restock** for deliveries so stock history remains accurate.
- Export sales at the end of each day or configure Firebase backup.
- Test every new deployment with a sale, restock, receipt, and staff login before using it in a live shop.
- Keep the app and browser updated on shop devices.

## Roadmap

- Named-account sign-in and password recovery
- Secure staff invitations and server-side role management
- Multi-device live inventory with conflict handling
- Stock transfers, purchase orders, supplier balances, and returns
- Voids/refunds with approval workflow
- Central owner dashboard for multiple shops
- Monitoring, backups, automated tests, and continuous deployment

## License

Add a license file before publishing or distributing the project. Until then, all rights are reserved by the project owner.
