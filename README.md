# book_lovers.kz — website files

A ready website in plain HTML, CSS and JavaScript. No installation and no database are needed.

## Look at it on your computer

Unzip the folder and double-click **index.html**. It opens in your browser.

## Put it on the internet

Upload the **whole folder** (keep the folders inside it) to any web hosting:

- **Netlify** (free): sign in at netlify.com → "Add new site" → "Deploy manually" → drag this folder onto the page. You get a link at once and can connect your domain book-lovers.kz later.
- **GitHub Pages** (free): create a repository, upload these files, then Settings → Pages → deploy from the main branch.
- **Any hosting in Kazakhstan with cPanel/FTP**: upload the files into the `public_html` (or `www`) folder.

`index.html` must be in the top folder of the site.

## What's in the folder

| File / folder | What it is |
|---|---|
| `index.html` | The shop (all pages: home, catalog, book pages, children's books, offers, reviews, contacts, cart, checkout) |
| `admin.html` | Your catalog editor (not linked from the shop) |
| `data/store.js` | All books, prices, stock, promotions, reviews and contacts |
| `js/i18n.js` | All interface texts in Russian, Kazakh and English |
| `js/app.js` | The shop's logic: search, filters, cart, discounts, checkout |
| `css/style.css` | The design |
| `images/covers/` | Book covers |
| `fonts/` | Lora and Inter fonts (free licence, see LICENSE.txt) |

## How orders work

The customer fills in the cart and checkout. The site then opens **WhatsApp** with a ready message to your number: order number, books, quantities, total, delivery and contact details. The order arrives as soon as the customer presses Send. Recommendation requests and reviews come to WhatsApp the same way.

The website itself does not store orders, take payments or reduce stock automatically. After a sale, lower the stock in the editor.

## How to change books, prices, promotions and contacts

1. Open **admin.html** in your browser (from your computer or `your-site/admin.html`).
2. Make changes:
   - **Books**: add, edit, hide or delete books; change price, sale price and stock; mark Popular / New / Home shelf / Sale.
   - **Promotions**: percent, fixed amount or "3+ books" discounts with start and end dates.
   - **Reviews**: add, hide or delete.
   - **Settings**: WhatsApp number, phone, Instagram, TikTok, pickup address, delivery prices, announcement bar, demo labels.
   - **Import & export**: load books from an Excel/Google Sheets CSV file, or download the catalog.
   - To remove all demo books and sample reviews: Settings → "Удалить демо-данные".
3. Press **"Скачать store.js"** (Download store.js).
4. On your hosting, replace `data/store.js` with the downloaded file. Customers see the changes after they reload the page.

**New cover**: in the book form choose the image file; the editor shows it and writes the path `images/covers/<file name>`. Copy that image file into the `images/covers/` folder on your hosting as well.

Your unsaved edits are kept in the browser you used for admin.html, so you can close it and continue later.

Note: admin.html can't change the live site by itself; it only produces the new `data/store.js`. If you don't want others to see the editor, don't upload admin.html — keep it on your computer next to a copy of the site.

## Before you open the shop

- The 40 books, stock and "popular" marks are demo examples; the covers are generated placeholders, not publisher artwork. Replace them with your own books.
- The 6 reviews are samples and are labelled "Пример отзыва". Remove them and add real ones.
- Check the WhatsApp number (now +7 747 362 46 38) and add Instagram/TikTok links in Settings.
- The privacy policy and terms pages are drafts. Have them checked, and check business registration and tax rules before accepting payments.
- Have a native speaker review the Kazakh texts (`js/i18n.js` and the book descriptions).
