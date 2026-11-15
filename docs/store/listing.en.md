# 1688 Helper

> Watch SKU changes on 1688 products and get notified · Claim automation framework for late-collection orders · One-click product import into your own self-hosted workbench

1688 Helper is a browser extension for 1688 (China B2B marketplace) buyers. It works on top of your existing logged-in 1688 session. All data is stored locally in your browser; nothing is sent to any third-party server.

## Features

- **SKU change monitoring (fully functional)**: watch all SKUs of products you follow — added/removed SKUs, spec and attribute changes, stock changes, in-stock ↔ out-of-stock, price changes. Scheduled background scans with desktop and/or Webhook notifications; the first scan only establishes a baseline (no noise); a product is auto-paused after 3 consecutive failures; full change history and JSON export.
- **Late-collection claim automation (framework only)**: the scan → apply pipeline, state machine, dedup, retry (max 3), batch summary notifications and human-in-the-loop are implemented and tested with simulated data. Real claim pages have not been adapted yet (your account currently has no late-collection orders). **No real claim is ever submitted.**
- **Workbench import (optional module)**: on any 1688 product page, click the floating import button, preview the collected data (name/price/attributes/SKU/images), pick what you want, and import it into your own self-hosted workbench service. If the same offer was already imported, the extension asks you whether to update it or create a new entry.
- **Data & backup**: all data (orders, products, SKU snapshots, change log, task log, notifications) lives in your browser's IndexedDB; one-click JSON export/import.

## Privacy

- The extension **does not upload any data** to the developer; the developer runs no server.
- The extension contacts only the 1688 pages you visit and the Webhook / workbench URLs **you explicitly configure and authorize** in settings.
- Tokens and webhook URLs are stored only in your browser (chrome.storage.local / IndexedDB) and never appear in logs.
- Privacy policy: <https://github.com/mufeng510/1688-helper/blob/main/docs/store/privacy-policy.md>

## Requirements

- You must be logged into 1688 in this browser;
- Monitoring/import features use your existing session — the extension never bypasses captcha or anti-bot controls (it pauses and asks for manual action instead);
- The "import to workbench" module requires your own self-hosted workbench service (see docs/IMPORT_1688.md).

## Source

<https://github.com/mufeng510/1688-helper>
