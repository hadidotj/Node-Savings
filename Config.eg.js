/**
 * Node-Savings Configuration.
 *
 * Some of the settings here are for the node-imap and nodemailer modules.
 * Please refer to their documentation for configuration options that are not
 * displayed below.
 */
var Config = module.exports = {
	/**
	 * If true, prints debug messages. Default is false.
	 */
	'debug': false,

    /**
     * IMAP Email Configuration.
     *
     * See the node-imap documentation on the IMAP constructor's config object.
     */
    'imap': {
        'user': 'username',
        'password': 'password',
        'host': 'imap.gmail.com',
        'port': 993,
        'tls': true
    },

    /**
     * Node-Mailer Email Configuration.
     *
     * See the nodemailer-smtp-transport documentation on options.
     */
    'mailer': {
		service: 'gmail',
		auth: {
			user: 'username',
			pass: 'password'
		}
    },

    /**
     * The name of the mailbox to open. Typically this is just INBOX.
     */
    'mailbox': 'INBOX',

	/**
	 * The IMAP flags to set on marked messages.
	 */
	'processedFlags': [ 'Seen', 'Deleted' ],

    /**
     * The name of the GMail Label or IMAP mailbox to move processed messages
     * to.
     */
    'processedBox': 'Processed',

    /**
     * The IMAP search criteria. By default, we search for all messages in the
     * given mailbox (defined above) that do not have the 'SEEN' flag set.
     * See node-imap documentation on the 'search' method.
     */
    'searchCriteria': [ 'UNSEEN' ],

    /**
     * The fields of a message to fetch from the IMAP server. By default, we
     * fetch the FROM header and the body text. See the node-imap documentation
     * on the 'fetch' method.
     */
     'fetchFields': { bodies: [ 'HEADER.FIELDS (FROM)', 'TEXT' ] },

    /**
     * List of "From" (email header) notification messages should be processed
     * from. Includes just the name, email address or both the name and
     * address.
     */
    'fromList': [
        'From Name',
        'or_email@address.work',
        'Name And <email@also.work>'
    ],

    /**
     * The name of the file to save persistent data to.
     */
	'saveFile': 'saveFile.json',

    /**
     * An array of one or more regular expressions that are used to parse each
     * email for anything you want to use in your calculation.
     */
    'messagePatterns': [
        '(\\$\\d+\\.\\d{2})',
        'You spent (\\$\\d+\\.\\d{2}) at (.*?) on (.*? (AM|PM))'
    ],

    /* ########################################################################
     # The following section has a list of events that get triggered.
     # None of them are required to be defined, but are shown here for
     # examples of what you can listen for.
     # ######################################################################*/

    /**
     * Pre-Connect Event.
     * Called before connecting to the IMAP server.
     * @param imapSettings - The settings object being passed to the IMAP
     *     constructor.
     * @return the settings object to actually use. If null is returned, then
     *     {imapSettings} will be used.
     */
    'preConnect': function(imapSettings) { return imapSettings; },

    /**
     * Pre-OpenMailbox Event.
     * Called before the IMAP openBox method opens the configured mailbox.
     * This allows you to change the mailbox name.
     * @param mailboxName - The name of the mailbox being opened
     * @return the name of the mailbox to actually open. If null is returned,
     *     then {mailboxName} will be used.
     */
    'preOpenMailbox': function(mailboxName) { return mailboxName; },

    /**
     * Pre-Search Event.
     * Called before the IMAP search method is called. This allows you to
     * change the search criteria before searching.
     * @param criteria - The array of search criteria for which messages to be
     *     parsed
     * @return the search criteria to actually use. If null is returned, then
     *     {criteria} will be used.
     */
    'preSearch': function(criteria) { return criteria; },

    /**
     * Post-Search Event.
     * Called after the IMAP search has been preformed.
     * @param err - A error object if an error occurred during search
     * @param results - An array of message UIDs that were found by the search
     * @return true if the messages should be parsed. If null is returned, then
     *     it will assume execution should continue if no error occurred and
     *     there was at least one message to parse.
     */
    'postSearch': function(err, results) {
        return err == null && results.length > 0;
    },

    /**
     * Pre-Fetch Event.
     * Called before the IMAP fetch method is called.
     * @param fetchFields - The array of fields to obtain from the IMAP fetch.
     * @return the fetchFields to acutally use. If null is returned, then
     *     {fetchFields} will be used.
     */
    'preFetch': function(fetchFields) { return fetchFields; },

    /**
     * Pre-Message Event.
     * Called before message data is obtained from the IMAP server.
     * @param msg - The message object
     * @param seqNo - The message number in the current sequence
     * @return false if the message should not be downloaded. If null is
     *     returned, then it will assume the message should be downloaded.
     */
    'preMessage': function(msg, seqNo) { return true; },

    /**
     * Pre-Parse Event.
     * Called before the message's FROM field is checked and parsed. This check
     * is used to decide if the email is from a notification source and should
     * be parsed.
     * @param msgInfo - The message info object for this message
     * @param fromList - The array of from names, addresses or both used to
     *     check the message's FROM field
     * @return Mixed: Return true or false if the message should or should not
     *     be parsed. Return an array of email names, addresses or both to check
     *     the from header of the email with. If null is returned, it is assumed
     *     the message should be parsed if the message's from header matches an
     *     entry in the {fromList} configuration setting.
     */
    'preParse': function(msgInfo, fromList) {
    	return (msgInfo.from == 'NotInList <test@test.com>') ? true : fromList;
    },

    /**
     * Post-Parse Event.
     * Called after a message has been parsed.
     * @param parsedArr - The array of successfully matched RegEx patterns from
     *     the {messagePatterns} setting.
     * @param msgInfo - The message info object for this message
     * @return false if the message should not be marked as read and be
     *     deleted from the IMAP server. If null is passed, it will assume
     *     the message should NOT be marked as read and deleted.
     */
    'postParse': function(parsedArr, msgInfo) { return true; },

    /**
     * Pre-Save Event.
     * Called before {data} is saved to file.
     * @param data - The data object being saved
     * @return the data object to actually save. If null is returned, then
     *     {data} will be used.
     */
    'preSave': function(options) { return options; },

    /**
     * Post-Disconnect Event.
     * Called after the connection to the IMAP server has been closed.
     * @param hadError - true if the disconnect was caused by an error
     */
    'postDisconnect': function(hadError) { },

    /* ########################################################################
     # You can define your own setting keys or functions you can use within
     # your event handlers here. To call them, you can ether use `this` or the
     # `Config` object. See below for an example.
     # ######################################################################*/

    'customProp': [1, 15],

    'customFunction': function(msgInfo) {
        // If I wanted this function triggered in the Post-Parsed event, I
        // could call customFunction by either using the Config object or
        // `this`:
        this.customFunction(msgInfo);
        Config.customFunction(msgInfo);

        // You can do the same to access custom properties
        for(var i in Config.customProp) {
            Config.NodeSavings.log(this.customProp[i]);
        }

        // You can also send emails
        //var addresses = "single@email.address"
        //var addresses = "two@to.emails,by@comma.also"
        var addresses = {
        	to: [ 'first@to.address', 'second@address-in.array' ],
        	cc: 'first@cc.address,second@cc-by.comma',
        	bcc: 'single@bcc.address'
        };
        var from = 'Display Name <and@email.address>';
        var subject = 'Test Email';
        var text = 'This is the response text in the email.';
        var callback = function(err,info) {
        	if(err) {
				console.error('[ERROR]  Failed to send email: ' + err);
			} else {
				Config.NodeSavings.info('Message sent successfully! ' + info);
			}
        }
        Config.NodeSavings.sendMail(addresses, from, subject, text, callback);
    }
};
