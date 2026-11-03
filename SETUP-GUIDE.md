# Setting up the books

About 30 minutes, once. Do it signed in to the **shop Google account**, the same one that owns the order Sheet.

The books are separate from the order site:
- a new Google Sheet;
- a new Apps Script, with its own web address and its own key;
- a new GitHub repo.

Nothing here changes the order page. The books only **read** the order Sheet to count website sales.

## Before you start

- Use a **computer**, not a phone: the Apps Script editor does not work well on a phone.
- Make sure you are signed in to the **shop Google account**. Click your picture in the top right of any Google page to check which account is active. If you are signed in to more than one account, open a private/incognito window and sign in only to the shop account. Google often mixes up accounts otherwise.
- Have the **order Sheet** (the one the order site uses) open in another tab.

## 1. Make the books Sheet

1. Go to [sheets.new](https://sheets.new). A new, empty Google Sheet opens.
2. Click **Untitled spreadsheet** at the top left and type **Supa Juice Books**. Press Enter.
3. Leave the Sheet empty. The script makes the tabs (Expenses, Money in, Batches, Settings) itself in step 4.

## 2. Paste in the script

1. In the books Sheet, open the menu **Extensions > Apps Script**. A new tab opens with the script editor.
2. Click **Untitled project** at the top left, type **Supa Juice Books**, and press **Rename**.
3. On the left, under **Files**, `Code.gs` is already selected. On the right is a few lines of code starting with `function myFunction()`.
4. Click inside that code, select all of it (**Ctrl+A**, or **Cmd+A** on a Mac) and delete it, so the editor is empty.
5. In another tab, open [`apps-script/Code.gs` on GitHub](https://github.com/supajuice/books/blob/main/apps-script/Code.gs). Click the **Copy raw file** button (two overlapping squares, top right of the code).
6. Back in the editor, click inside the empty area and paste (**Ctrl+V** / **Cmd+V**). The file is about 920 lines and starts with `/**  * Supa Juice books: Google Apps Script backend.`
7. Press the **Save** icon (a floppy disk) above the code, or **Ctrl+S** / **Cmd+S**. The orange dot next to `Code.gs` disappears when it is saved. If a red error appears, the paste was incomplete: delete everything and paste again.

## 3. Connect it to the order Sheet (read only)

The books need to know which Sheet holds the website orders. They only ever read it.

1. Go to the tab with the **order Sheet**. Look at the address bar. It looks like:

   `https://docs.google.com/spreadsheets/d/`**`1AbCdEfGh...XyZ`**`/edit#gid=0`

   The **Sheet ID** is the long part between `/d/` and `/edit`. Select exactly that part and copy it. Don't include the slashes.
2. Back in the books script editor, click the **gear** icon on the far left (**Project Settings**).
3. Scroll to the bottom, to **Script Properties**, and click **Add script property**.
4. Under **Property**, type `ORDER_SHEET_ID` exactly: capital letters, with underscores.
5. Under **Value**, paste the Sheet ID.
6. Click **Save script properties**.
7. Click the **< >** icon on the far left (**Editor**) to go back to the code.

Script properties are private to the script. They are not in the Sheet and not on GitHub.

## 4. Run setup and give permission

1. Above the code there is a toolbar with **Run**, **Debug** and a drop-down showing a function name. Click the drop-down and choose **setup**.
2. Click **Run**.
3. A box says **Authorization required**. Click **Review permissions**.
4. Choose the **shop Google account**.
5. A page says **Google hasn't verified this app**. This is normal: it is your own script, not an app from someone else. Click **Advanced** (small, bottom left), then **Go to Supa Juice Books (unsafe)**.
6. Google lists what the script wants to do. If there are tick boxes, tick **Select all**. Then click **Continue** or **Allow**. The script asks for:
   - **See, edit, create and delete your spreadsheets**: to write the books Sheet, and to read the order Sheet. It never changes the order Sheet.
   - **See, edit, create and delete your Google Drive files**: to save receipt photos in a folder named **Supa Juice receipts**. The folder appears the first time a receipt is saved.
7. The editor runs setup. The **Execution log** opens at the bottom. After a few seconds it shows:

   ```
   Setup done. Admin key created.
   Admin key: 3f9a...  (64 letters and numbers)
   Website sales: connected to the order Sheet.
   ```

   If the last line says **add ORDER_SHEET_ID**, step 3 did not save. Go back and check the property name.
8. Copy the **admin key** (the long code after `Admin key:`) and keep it somewhere private, such as a password manager. This is the **books key**. Anyone with it can see and change the books. It is a different key from the order site's admin key.
9. Go back to the books Sheet tab. It now has the tabs **Expenses**, **Money in**, **Batches** and **Settings**.
10. Optional check: in the function drop-down choose **checkSales** and click **Run**. The log says how many paid or delivered orders it found in the order Sheet. If it says it could not open the order Sheet, the Sheet ID in step 3 is wrong, or the order Sheet belongs to a different Google account.

Lost the key later? Choose **showAdminKey** in the drop-down and click **Run**.

## 5. Publish the web app

This gives the books page an address to talk to.

1. Click the blue **Deploy** button at the top right, then **New deployment**.
2. Next to **Select type**, click the **gear** icon and choose **Web app**.
3. Fill in:
   - **Description**: `Books` (anything is fine).
   - **Execute as**: **Me (the shop account's email)**. The script then reads and writes the Sheets as the shop account.
   - **Who has access**: **Anyone**.

     "Anyone" only means the page can reach the script without a Google sign-in. Nothing is shown to anyone without the books key.
4. Click **Deploy**. If Google asks for permission again, allow it as in step 4.
5. A box shows the **Web app URL**. It starts with `https://script.google.com/macros/s/` and ends with `/exec`. Click **Copy**, then **Done**.
6. Check it: paste the URL into a new browser tab. The page should show only:

   ```
   {"ok":true,"service":"books"}
   ```

   If you see a Google sign-in page or "You do not have permission", **Who has access** is not set to **Anyone**. Fix it with **Deploy > Manage deployments > pencil (Edit)**.
7. Send the Web app URL to Vishwesh (it is not secret). It goes in [`docs/config.js`](docs/config.js) as `endpoint`, then it's committed and pushed.

### Later, when Code.gs changes

Pasting new code is not enough on its own: the web app keeps running the old version until you publish a new one, and the address must stay the same.

1. Paste the new `Code.gs` over the old one and **Save**.
2. Click **Deploy > Manage deployments**.
3. Select the deployment and click the **pencil** icon (**Edit**).
4. Under **Version**, choose **New version**. Click **Deploy**.
5. If the change notes say so, run **setup** again. It adds new columns and settings and never overwrites what is already there.

Don't use **Deploy > New deployment** for updates: that makes a new address, and the books page would still talk to the old one.

## 6. Turn on GitHub Pages

In the repo on GitHub, go to **Settings > Pages**:
- Source: **Deploy from a branch**;
- Branch: **main**, folder **/docs**.

The page appears at **https://supajuice.github.io/books/**.

## 7. Open it on your phone

Open `https://supajuice.github.io/books/#YOUR-BOOKS-KEY` once. The key is saved on that phone and removed from the address bar. Add the page to the home screen.

Give the link only to the owners. If it leaks, run **rotateAdminKey** and share the new link.

## 8. The first entries

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
| "Website sales are not connected yet" | Add the `ORDER_SHEET_ID` script property (step 3), then reload the page. |
| "Could not open the order Sheet" | The ID is wrong, or the order Sheet belongs to a different Google account. |
| "The order Sheet columns have changed" | Someone renamed a column in the order Sheet's Orders tab. The books read **Invoice, Qty, Total, Status, Paid on**, and a few more, by name. |
| A wrong entry | Ledger > Edit. **Remove** hides it but keeps the row in the Sheet, marked removed, so there is always a trail. |
