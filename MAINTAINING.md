# Keeping the books

How to keep the Supa Juice books accurate, week by week and year by year. This is for the owners. For first-time setup, see [SETUP-GUIDE.md](SETUP-GUIDE.md).

The rule behind everything: **every rand that moves gets one entry, with its receipt, on the day it moves.** If something isn't entered, the report can't know about it.

## The routine

### Every time money moves (1 minute)

| What happened | What to add |
|---|---|
| You bought something for the business | **Expense**. Photograph the receipt there and then. |
| An owner paid for something with their own card | **Expense**, with **Who paid?** set to that owner. The business now owes them. |
| An owner put money into the business account | **Money in > Loan** (to be paid back) or **Capital** (their share). |
| The business paid an owner back | **Money in > Paid back**. |
| You sold gels outside the website (race stall, cash, EFT to you directly) | **Money in > Other sale**, with the number of sachets. |
| You made a batch | **Batch**: flavour, sachets made and what its ingredients and packaging cost. |
| A customer paid on the website | Nothing. Website sales come from the order Sheet once the order is marked **Paid**. |

### Every week (5 minutes)

- **Ledger > Expenses**: look for **No receipt** flags. Find the slip or email and attach it (Edit > Replace the receipt).
- Mark website orders **Paid** on the order site as the money arrives. The books count a sale on the day it was marked paid.

### Every month (15 minutes, in the first week of the next month)

1. **Report > Last month.**
2. **Check cash against the bank.** Compare **Cash on hand** with the bank statement balance on the last day of the month.
   - **They match**: done.
   - **The bank has less**: an expense, a card fee or a refund is missing. Go through the statement line by line against the Ledger.
   - **The bank has more**: money in is missing, such as an owner top-up, a cash sale, or an order that was paid but never marked Paid.
3. **Check the freezer.** Count the sachets and compare with **Should be in the freezer**. A difference means sachets were given away, lost, or a batch or sale wasn't entered (see "Sachets given away" below).
4. **Settle up.** Look at **Owners: The business owes …**. If there's spare cash, pay an owner back and add **Money in > Paid back**.
5. **Download for an accountant (CSV)** and save it in a "Books" folder in Drive, named by month. The download is a snapshot, so it still exists even if an entry is later changed.

### Every tax year (by the end of March)

The SARS tax year runs **1 March to the end of February**.

1. Do the monthly check for February.
2. **Report > Last tax year > Download for an accountant.**
3. Give the accountant:
   - that CSV;
   - access to the **Supa Juice receipts** Drive folder;
   - the year's bank statements.
4. Look at **Tax year > Turnover**. If you're getting near **R1 million** in 12 months, talk to the accountant about VAT registration *before* you pass it.
5. Decide with the accountant how any owner money still owed is treated going forward.

## Situations

**A back-dated receipt, found later.**
Add it with its real date (the date on the receipt). It joins the report for that month.
- If that month was already checked against the bank, do the check again.
- If the date is before **Books start on**, the page says so: the entry counts towards profit and owners, but not cash on hand.

**A mistake in an entry.**
Ledger > Edit, fix it, Save. The Sheet records when it was edited.

**An entry that should not be there.**
Ledger > Edit > Remove (tap twice). It disappears from the page and reports, but stays in the Sheet with a **Removed on** date. Never delete rows in the Sheet by hand: the trail is what makes the books trustworthy.

**A refund to a customer.**
On the order site, cancel the order. If it was already paid and you sent money back, the books stop counting the sale once it is no longer Paid or Delivered. If only part was refunded, add an **Expense > Other** with what was paid back, noting the invoice number.

**Sachets given away (samples, race freebies, sponsorships).**
- **No money entry is needed.** Their ingredients and packaging were already counted as expenses when you bought them. Adding them again would count the cost twice.
- The freezer will hold fewer than **Should be in the freezer**, by the number given away. Keep a short list (date, how many, where) and use it to explain the difference at the monthly freezer check.
- If you **bought** something just for a giveaway (prizes, a stall fee), that is an **Expense > Marketing**.

**Paystack fees.**
By default the report estimates them from the rate in Settings. Once a month, compare with the Paystack dashboard.
- If the estimate is close, leave it.
- If you want the real figures, switch **Settings > Card payment fees** to **I’ll add them**, and add each month's total as an **Expense > Payment fees**. Never do both.

**Pudo and courier costs.**
Customers pay a delivery fee on website orders. That is income. What you pay Pudo is an **Expense > Shipping & boxes**. Over a month the two should roughly cancel out.

**A new owner or investor.**
- Settings > Owners > Add their name.
- When their money arrives, add **Money in > Capital** (a share) or **Loan**, as agreed in writing.
- Keep the agreement itself somewhere safe. The books record the money, not the terms.

**An owner leaves.**
- First settle up: pay back what the business owes them (**Money in > Paid back**), and agree in writing what happens to their capital.
- Then **Settings > Owners > Remove** (tap twice if they have entries).
- Their past entries stay, and can still be edited. New entries can no longer name them. The report keeps showing them as a *former owner* with whatever is still owed, so nothing quietly disappears.

**Subscriptions (Claude Code, domain, apps).**
One **Expense > Tech & software** each time you're billed, with the invoice email saved as a PDF receipt. If it's on an owner's card, set **Who paid?** to them.

**Lost receipt.**
Add the expense anyway, with a note saying why ("receipt lost, bank statement 12 Oct"). Then attach a screenshot of the bank statement line as the receipt.

**Mixed shopping** (business and personal on one slip).
Enter only the business part as the amount. Note "Personal items excluded" and attach the full slip.

## Looking after the system

- **The books key** is in the link to the page. If a phone is lost or the link is shared by accident, the shop account runs **rotateAdminKey** in Apps Script and sends the owners the new link.
- **Don't edit the Sheet's headers or column order.** Typing a correction into a cell is fine. If you must, Settings can be edited in the Settings tab.
- **Don't rename the order Sheet's Orders tab or its columns.** The books read **Invoice, Qty, Unit price, Delivery fee, Total, Status, Paid on, Notes** and **Created** by name. If they change, the report shows a warning instead of sales.
- **Backups.** Google keeps version history (**File > Version history**). The monthly CSV downloads are a second copy.
- **Changing the script.** Use **Deploy > Manage deployments > Edit > New version**, so the address stays the same. Run **setup** after an update that adds columns or settings. It never overwrites what is already there.
- **Records are kept for 5 years.** Don't delete old receipts or Sheet rows, even after the accountant is done with a year.

This guide describes how to use the books. It is not tax or accounting advice: an accountant or registered tax practitioner can tell you what applies to Supa Juice.
