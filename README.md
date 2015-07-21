# Node-Savings
Do you want to keep track of the amount of money spent at a particular store?
Maybe once a month you would like to take 5 percent of every purchase made and
place that into your savings account. Want to get notified that you are spending
to much for lunch, which is usually sometime between 11 and 14 on weekdays?
Node-Savings is a highly customizable way to keep track of spending habits.

Node-Savings monitors an IMAP Email account, such as Gmail, for notifications
from your spending account (if your bank provides such a service and it is
configured to do so). You specify a list of email addresses notifications would
be coming from, regular expression formats that are used to parse the
notification, custom triggers and custom logic! The Node-Savings API provides
you a framework to track your spending and help you save!

*NOTE:* This is a work in progress. It currently works as shown in the
[Example Config File](Config.eg.js).

# Requirements
* Required: [Node-Imap](https://github.com/mscdex/node-imap) -- v0.8.14 or newer
* Optional: [Node-Mailer](https://github.com/andris9/Nodemailer) -- v1.3.4 or newer
    - Optional if you wish to send emails

# Examples and Documentation
[View the example config file](Config.eg.js)