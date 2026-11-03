# Setting up the books

About 20 minutes, once. Do it signed in to the **shop Google account**, the same one that owns the order Sheet.

The books are separate from the order site:
- a new Google Sheet;
- a new Apps Script, with its own web address and its own key;
- a new GitHub repo.

Nothing here changes the order page. The books only **read** the order Sheet to count website sales.

## 1. Make the Sheet and paste the script

1. Go to [sheets.new](https://sheets.new) and name the Sheet **Supa Juice Books**.
2. Open **Extensions > Apps Script**.
3. Delete what is in `Code.gs`, paste in all of [`apps-script/Code.gs`](apps-script/Code.gs), and press **Save**.

## 2. Connect it to the order Sheet (read only)

1. Open the **order** Sheet. Its address looks like `https://docs.google.com/spreadsheets/d/`**`1AbC...xYz`**`/edit`. Copy the long part in bold.
2. Back in the books' Apps Script, go to **Project Settings** (the gear) **> Script properties > Add script property**.
3. Add a property named `ORDER_SHEET_ID` with the long part you copied as its value. Press **Save script properties**.

## 3. Run setup

1. In the editor, pick **setup** in the function list and press **Run**.
2. Google asks for permission:
   - the books Sheet;
   - the order Sheet (it is only read);
   - Google Drive, to keep receipt photos in a folder named **Supa Juice receipts**.

   Allow them. "Google hasn't verified this app" is normal for your own script: **Advanced > Go to … (unsafe)**.
3. The log shows the **books key**. Copy it somewhere private, such as a password manager.
4. Optional: run **checkSales**. It logs how many paid orders it can see in the order Sheet.

## 4. Publish the web app

1. Go to **Deploy > New deployment**, choose the gear, then **Web app**.
2. Set **Execute as: Me** and **Who has access: Anyone**.

   "Anyone" only means the page can reach it. Every request still needs the books key.
3. Copy the **Web app URL** (it ends in `/exec`).
4. Put it in [`docs/config.js`](docs/config.js) as `endpoint`, then commit and push.

After changing `Code.gs` later, use **Deploy > Manage deployments > Edit > Version: New version**. That keeps the same address.

## 5. Turn on GitHub Pages

In the repo on GitHub, go to **Settings > Pages**:
- Source: **Deploy from a branch**;
- Branch: **main**, folder **/docs**.

The page appears at **https://supajuice.github.io/books/**.

## 6. Open it on your phone

Open `https://supajuice.github.io/books/#YOUR-BOOKS-KEY` once. The key is saved on that phone and removed from the address bar. Add the page to the home screen.

Give the link only to the owners. If it leaks, run **rotateAdminKey** and share the new link.

## 7. The first entries

1. **Settings**
   - **Books start on**: the day you start, for example 1 March 2026, the start of the SARS tax year.
   - **Business account balance on that day**.
2. **Money already put in.** For each amount Greg put in so far, choose **Money in > Loan** (to be paid back) or **Capital** (his share). Decide this together, ideally with an accountant, because it matters to an investor later.
3. **Old receipts.** Add them as **Expenses**. If Greg paid from his own account, set **Who paid?** to Greg: the report then shows the business owes him that money.
4. **Batches.** Add each batch made so far, with what its ingredients and packaging cost. This gives the cost per sachet and the stock count.

## Habits that keep the books right

The full routine (weekly, monthly, yearly) and what to do in unusual cases are in [MAINTAINING.md](MAINTAINING.md).

- **Snap every receipt the moment you pay**: Add > Expense > take a photo. Every expense without a receipt is flagged.
- **Each month**: open **Report > Last month**, and check **Cash on hand** against the bank statement. If they differ, something was not entered.
- **Personal cards**: when an owner pays for something themselves (Claude Code, a domain, ads), choose them under **Who paid?**. When the business pays them back, add **Money in > Paid back**.
- **Card fees**: by default they are worked out from the Paystack rate in Settings. If you would rather enter the real fees from the Paystack statement, choose **Card payment fees > I’ll add them** and add them as **Payment fees** expenses. Don't do both, or they are counted twice.
- **A separate business bank account** makes all of this much easier. Customers pay into the account on the order site's Settings. Cash on hand assumes that account is the business account.

## South Africa: what the books help with

This is general information, not tax advice. Speak to an accountant or tax practitioner.

- **SARS tax year**: 1 March to the end of February. Report > **This tax year** and **Last tax year** follow it.
- **Keep records for 5 years.** Receipts are saved in Google Drive under **Supa Juice receipts**. Don't delete that folder. To let another owner open them, share the folder with them.
- **VAT**: registration is compulsory once turnover passes **R1 million** in 12 months. The report shows how far along you are. If you register, set **Registered for VAT** to Yes to record VAT on each expense.
- **Turnover tax** is a simpler tax for micro businesses with turnover up to R1 million. Ask an accountant whether it suits you.
- **The download** (Report > Download for an accountant) gives every entry and website sale for the period, plus a summary, as a CSV that opens in Excel or Google Sheets.

## If something goes wrong

| What you see | What to do |
|---|---|
| "That key is not right" | Run **showAdminKey** in Apps Script and open the link again with that key. |
| "Website sales are not connected yet" | Add the `ORDER_SHEET_ID` script property (step 2), then reload the page. |
| "Could not open the order Sheet" | The ID is wrong, or the order Sheet belongs to a different Google account. |
| "The order Sheet columns have changed" | Someone renamed a column in the order Sheet's Orders tab. The books read **Invoice, Qty, Total, Status, Paid on**, and a few more, by name. |
| A wrong entry | Ledger > Edit. **Remove** hides it but keeps the row in the Sheet, marked removed, so there is always a trail. |
