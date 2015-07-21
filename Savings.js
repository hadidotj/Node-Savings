#!/usr/bin/env node
/**
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Tyler Hadidon
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
'use strict';

/** Global NodeSavings object. */
var NodeSavings = {
    /** Settings object from Config.js. */
    settings: null,

    /** Data object from the NodeSavings.settings.saveFile. */
    data: null,

    /** Debug variable (can be set in config) */
    _debug: false,

    /** Holds reference to the Node FS module. */
    _fs: require('fs'),

    /** Holds reference to the IMAP connection object. */
    _imap: null,

    /** Holds a reference to the IMAP ParseHeader method. */
    _imapParseHeader: null,

    /** Holds reference to the NodeMailer object. */
    _mailer: null,

    /** An array of message UIDs marked for deletion. */
    _markedForPostProcess: [],

    /**
     * Initializes the Node Savings object and starts off notification
     * processing.
     */
    init: function() {
        // Load the imap module
        var imapModule = this.getModule('imap', 'Unable to load the imap ' +
                'module. This module is required in order to obtain ' +
                'notification emails from a IMAP server. Run the following ' +
                'to install it:' + "\n" +
                '   > npm install imap');
        this._imapParseHeader = imapModule.parseHeader;

        // Load the config file
        var configFileName = this.getConfigFileName();
        this.settings = this.getModule(configFileName,
                'Failed to load config file "' + configFileName + '"!', true);

        // Load debug setting
        this._debug = this.getSetting('debug', false);
        this.info('Debugging is enabled!');

        // Load from the persistent data file, if it exists
        var saveFileName = this.getSaveFileName();
        try {
            this.data = require(saveFileName);
            this.info('Loaded data from existing file.');
        } catch(e) {
        	this.data = {};
            console.warn('[WARNING] Could not load save file "' + saveFileName +
                    '". Using empty object.');
        }
        NodeSavings.settings.data = NodeSavings.data;
        NodeSavings.settings.NodeSavings = NodeSavings;

        // Create a new IMAP instance and register all of it's event listeners
        this._imap = new imapModule(this._preConnect());
        this._imap.once('ready', this._imapReady);
        this._imap.on('mail', this._imapMail);
        this._imap.on('error', this._imapError);
        this._imap.once('close', this._imapClosing);
        this._imap.connect();

        // Shutdown when Ctrl + c is pressed
        process.on('SIGINT',function () {
        	this.info('Received SIGINT. Starting shutdown process.');
        	this._imap.end();
        });
    },

    /**
     * A method for sending an email to a given address.
     * @param addresses - Mixed. Either the email address to send to or an
     *     object with members to, cc or bcc which are arrays of addresses to
     *     send to.
     * @param from - The email address the message comes from
     * @param subject - The subject of the message
     * @param text - The message to send
     * @param callback - Optional callback to call after message is sent
     */
    sendMail: function(addresses, from, subject, text, callback){
    	// Make sure there is a node-mailer object
		if(!this._mailer) {
			var mailerSettings = this.getSetting('mailer', null);

			// Make sure there is a setting
			if(mailerSettings) {
				var nodeMailer = this.getModule('nodemailer', 'Unable to load' +
					' the nodemailer module. This module is required to ' +
					'send an email. Run the following to install it:' + "\n" +
					'   > npm install nodemailer');
				this._mailer = nodeMailer.createTransport(mailerSettings);
			} else {
				console.error('[ERROR] Node mailer settings not found. Cannot ' +
					'send mail!');
				return;
			}
		}

		// Figure out if to is an object or just a string
		if(typeof addresses === 'string') {
			addresses = { 'to': addresses };
		}

		if(!addresses.cc) {
			addresses.cc = [];
		}

		if(!addresses.bcc) {
        	addresses.bcc = [];
        }

		// Build node-mailer mail object
		var mailObject = {
			to: addresses.to,
			cc: addresses.cc,
			bcc: addresses.bcc,
			from: from,
			replyTo: from,
			subject: subject,
			text: text,
			html: text
		};

		// And send it off!
		this.info('Sending email message!');
		this._mailer.sendMail(mailObject, function(err, info) {
			if(callback) {
				callback(err, info);
			} else if(err) {
				console.error('[ERROR]  Failed to send email: ', err);
			} else {
				this.info('Message sent successfully!');
			}
		});
    },

    /**
     * Searches for new mail.
     */
    _searchNewMail: function() {
    	var criteria = NodeSavings._preSearch();
    	NodeSavings.info('Searching for new mail using: ' + criteria);
		NodeSavings._imap.search(criteria, function(err, results) {
			if(err) {
				console.error('[ERROR]  An error occurred while searching ' +
					'messages: ' + err);
			}
			if(results && NodeSavings._postSearch(err, results)) {
				NodeSavings._fetchMessages(results);
			} else {
				NodeSavings.info('No new messages found matching criteria: ' + results);
			}
		});
    },

    /**
     * Fetches the messages with the given UIDs.
     * @param uids - An array of UIDs to fetch
     */
    _fetchMessages: function(uids) {
    	NodeSavings.info('Fetching messages: ' + uids);
		var f = NodeSavings._imap.fetch(uids, NodeSavings._preFetch());
		f.on('message', function(msg, seqNo) {
			NodeSavings._processMessage(msg, seqNo);
		});
		f.on('error', function(err) {
		 	console.error('[ERROR]  An error occurred while fetching emails: ' +
		 		err);
		});
		f.once('end', function() {
			NodeSavings.info('All messages have been fetched');
			NodeSavings._flagMarkedMessages();
			NodeSavings._saveValues();
		});
    },

	/**
	 * Processes the given message.
	 * @param msg - The message to process
	 * @param seqNo - The number in the fetch sequence
	 */
    _processMessage: function(msg, seqNo) {
    	NodeSavings.info('Processing message: ' + seqNo);
    	if(NodeSavings._preMessage(msg, seqNo)) {
			var msgInfo = { attributes: null, header: null };
			msg.on('body', function(stream, info) {
				var buffer = '';
				stream.on('data', function(chunk) {
					buffer += chunk.toString('utf8');
				});
				stream.once('end', function() {
					if(info.which.toLowerCase().indexOf('header') >= 0) {
						msgInfo.header = NodeSavings._imapParseHeader(buffer);
					} else {
						msgInfo[info.which.toLowerCase()] = buffer;
					}
				});
			});
			msg.on('attributes', function(attrs) {
				msgInfo.attributes = attrs;
			});
			msg.once('end', function() {
				if(NodeSavings._preParse(msgInfo)) {
					NodeSavings._parseMessage(msgInfo);
				}
			});
		} else {
			NodeSavings.info('preMessage event chose not to download message.');
		}
    },

	/**
	 * Parses the given message info with the {messagePatterns} configuration
	 * setting.
	 * @param msgInfo - The message info object
	 */
    _parseMessage: function(msgInfo) {
    	NodeSavings.info('Begin parsing message.');

    	// If there is no text, there is nothing to parse
    	if(!msgInfo.text) {
    		console.warn('[WARNING] This message does not have any text.');
    		return;
    	}

		var patterns = NodeSavings.getSetting('messagePatterns', []);
		var ret = [];

		// Parse each message
		for(var i in patterns) {
			var patResult = new RegExp(patterns[i], 'gim').exec(msgInfo.text);
			if(patResult != null) {
				ret.push(patResult);
			}
		}

		// Call the postParse method
		if(ret && ret.length > 0) {
			NodeSavings.info('Calling postParse: ' + ret);
			NodeSavings._postParse(ret, msgInfo);
		} else {
			NodeSavings.info('No patterns matched email.');
		}
    },

	/**
	 * Sets the flags on the marked messages
	 */
    _flagMarkedMessages: function() {
    	var messages = NodeSavings._markedForPostProcess;
    	NodeSavings.info('Flagging messages: ' + messages);
    	if(messages.length > 0) {
    		var defVal = ['Seen','Deleted'];
			var flags = NodeSavings.getSetting('processedFlags', defVal);
			if(flags) {
				NodeSavings._imap.addFlags(messages, flags, function(err) {
					if(!err) {
						NodeSavings._moveMarkedMessages();
					} else {
						console.error('[ERROR]  Failed to flag marked messages ' +
						 	' - ' + err);
					}
				});
			} else {
				NodeSavings.info('No flags defined in config.');
				NodeSavings._moveMarkedMessages();
			}
    	}
    },

	/**
	 * Moves the messages to the set label/folder for processed messages.
	 */
    _moveMarkedMessages: function() {
		var moveBox = NodeSavings.getSetting('processedBox', null);
		if(moveBox) {
			NodeSavings.info('Moving messages to: ' + moveBox);

			// If the server is a GMail server
			var callMe = null;
			if(NodeSavings._imap.serverSupports('X-GM-EXT-1')) {
				callMe = NodeSavings._imap.addLabels;
			} else {
				callMe = NodeSavings._imap.move;
			}
			callMe.call(NodeSavings._imap,
				NodeSavings._markedForPostProcess, moveBox,
				function(err) {
					if(!err) {
						NodeSavings._expungeIfRequired();
					} else {
						console.error('[ERROR]  Failed to flag marked messages ' +
							' - ' + err);
					}
				}
			);
		} else {
			NodeSavings.info('No processedBox defined. Messages not moved.');
			NodeSavings._expungeIfRequired();
		}
    },

    /**
     * Triggers an IMAP expunge if the Delete flag is part of the flags to be
     * added to processed emails.
     */
    _expungeIfRequired: function() {
		var flags = NodeSavings.getSetting('processedFlags',
			['Seen','Deleted']);
		if(flags && flags.length > 0) {
			for(var i in flags) {
				if(flags[i] == 'Deleted') {
					NodeSavings.info('Expunging messages!');
					NodeSavings._imap.expunge();
					return;
				}
			}
		}

		NodeSavings.info('No flags defined or Deleted flag not found. ' +
			'Messages not expunged.');
    },

	/**
	 * Saves the data object to a save file.
	 */
    _saveValues: function() {
    	var fileName = NodeSavings.getSaveFileName();
    	var saveObject = JSON.stringify(NodeSavings._preSave());
    	NodeSavings.info('Saving data to file: ' + fileName);
		NodeSavings._fs.writeFileSync(fileName, saveObject, 'utf8');
    },

    /* #########################################################################
     # Default Event Methods
     #########################################################################*/

	/**
	 * Some of the events triggered, such as preConnect or preOpenMailbox,
	 * can return a different value that originally set in the settings.
	 * This method does some common logic that gets the setting, calls the
	 * configured event method, if set, and returns the best value.
	 * @param settingName - The name of the setting property in the config
	 * @param defVal - The default value of the setting if not defined
	 * @param eventName - The name of the user-defined event, such as preConnect
	 * @return the user-returned value if not null, else the value from calling
	 *     the NodeSettings.getSetting(settingName, defVal) method.
	 */
     _doSettingEvent: function(settingName, defVal, eventName) {
		var setting = NodeSavings.getSetting(settingName, defVal);
		var userCB = NodeSavings.getSetting(eventName, null);

		// If there is a user-defined callback
		if(userCB) {
			var retVal = userCB(setting);

			// If the user-defined callback returned something other than null
			if(retVal != null) {
				setting = retVal;
			}
		}

		return setting;
     },

    /**
     * Called before creating a IMAP instance and connecting.
     * @return the settings object to use to make a new IMAP instance
     */
    _preConnect: function() {
        var imapSettings = NodeSavings._doSettingEvent('imap',
        	null, 'preConnect');

        // Varify there is at least a user and password
        if(!imapSettings || !imapSettings.user || !imapSettings.password) {
            NodeSavings.terminate(
                    'Could not find a user or password set for the IMAP ' +
                    'server. Either it was not set in the config file or ' +
                    'the "preConnect" event did not return them.', 1);
        }

        return imapSettings;
    },

	/**
	 * Called before opening the IMAP mailbox.
	 * @return the mailbox name to open
	 */
    _preOpenMailbox: function() {
		return NodeSavings._doSettingEvent('mailbox',
			'INBOX', 'preOpenMailbox');
    },

    /**
     * Called before searching for messages.
     * @return the search criteria to open
     */
    _preSearch: function() {
		return NodeSavings._doSettingEvent('searchCriteria',
			['UNSEEN'], 'preSearch');
    },

    /**
     * Called with the results of a IMAP Search.
     * @param err - An error object if an error occurred while searching
     * @param results - An array of message UIDs
     * @return true if the messages should be parsed, otherwise false
     */
    _postSearch: function(err, results) {
		var setting = (err == null && results.length > 0);
		var userCB = NodeSavings.getSetting('postSearch', null);

		// If there is a user-defined callback
		if(userCB) {
			var retVal = userCB(err, results);

			// Use that value if it isn't null
			if(retVal != null) {
				setting = retVal;
			}
		}

		return setting;
    },

    /**
     * Called before the IMAP server fetches the emails in order to customize
     * the fields that are fetched.
     * @return the fields to fetch
     */
    _preFetch: function() {
    	var defaultFields = { bodies: [ 'HEADER.FIELDS (FROM)', 'TEXT' ] };
		var fields = NodeSavings.getSetting('fetchFields', defaultFields);
		var userCB = NodeSavings.getSetting('preFetch', null);

		// If there is a user-defined callback
		if(userCB) {
			var retVal = userCB(fields);

			// Use that value if it isn't null
			if(retVal != null) {
				fields = retVal;
			}
		}

		return fields;
    },

    /**
     * Called to determine if a message should be downloaded or not.
     */
    _preMessage: function(uid, seqNo) {
    	var ret = true;
		var userCB = NodeSavings.getSetting('preMessage', null);

		// If there is a user-defined callback
		if(userCB) {
			var retVal = userCB(uid, seqNo);

			// If the user-defined callback returned something other than null
			if(retVal != null) {
				ret = retVal;
			}
		}

		return ret;
    },

    /**
     * Called to determine if a message should be parsed or not.
     * @param msgInfo - The message info object
     * @return true if the message should be parsed, otherwise false
     */
    _preParse: function(msgInfo) {
    	var fromList = NodeSavings.getSetting('fromList', []);
    	var userCB = NodeSavings.getSetting('preParse', null);

    	// If there is a user-defined callback
    	var checkFrom = true;
    	var doParse = true;
    	if(userCB) {
    		var retVal = userCB(msgInfo, fromList);

    		// If the result is not null
    		if(retVal != null) {
				// Check if it is exactly true or false
				if(retVal === true || retVal === false) {
					doParse = retVal;
					checkFrom = false;

				// If it is an array, change that out with the from list
				} else if(Array.isArray(retVal)) {
					fromList = retVal;
				} else {
					console.warn('[WARNING] User defined preParse callback ' +
						'did not return an array or boolean and was ignored.');
				}
    		}
    	}

    	// Check if we need to do a from check
    	if(checkFrom) {
    		doParse = NodeSavings.checkFrom(msgInfo, fromList);
    	}

    	return doParse;
    },

	/**
	 * Called after a message is parsed.
	 * @param parseArr - The array of successfully matched RegEx patterns
	 * @param msgInfo - The message info object for this message
	 */
    _postParse: function(parseArr, msgInfo) {
    	var userCB = NodeSavings.getSetting('postParse', null);

    	// If there is a user-defined callback
    	if(userCB) {
    		var ret = userCB.call(NodeSavings.settings, parseArr, msgInfo);
    		if(ret === true && msgInfo.attributes && msgInfo.attributes.uid) {
    			NodeSavings.info('Flagged message.');
    			NodeSavings._markedForPostProcess.push(msgInfo.attributes.uid);
    			NodeSavings.data = NodeSavings.settings.data;
    		} else {
    			NodeSavings.info('Not flagging message: ' + msgInfo.attributes);
    		}
    	} else {
             NodeSavings.info('No user defined callbcak for post-parse.');
        }
    },

    /**
     * Called before the data object is saved to file.
     * @return the object to store on file
     */
     _preSave: function() {
     	var dataToSave = NodeSavings.data;
     	var userCB = NodeSavings.getSetting('preSave', null);

     	// If there is a user-defined callback
     	if(userCB) {
     		var retVal = userCB(dataToSave);

     		// If the user-defined callback returned something other than null
     		if(retVal != null) {
     			dataToSave = retVal;
     		}
     	}

     	return dataToSave;
     },

    /* #########################################################################
     # IMAP Callbacks
     #########################################################################*/

	/**
	 * IMAP Callback when the connection is established.
	 */
    _imapReady: function() {
    	var mailboxName = NodeSavings._preOpenMailbox();
    	NodeSavings.info('Opening mailbox: ' + mailboxName);
		NodeSavings._imap.openBox(mailboxName, false, function(err, box) {
			if(err) {
				NodeSavings.terminate('Failed to open INBOX: ' + err);
			}
		});
    },

	/**
	 * IMAP Callback when new mail is received in the opened mailbox.
	 */
    _imapMail: function(numNew) {
    	NodeSavings.info('New mail received!');
		NodeSavings._searchNewMail();
    },

	/**
	 * IMAP Callback when an error occurs with the IMAP connection.
	 */
    _imapError: function(err) {
    	var timeout = NodeSavings.getSetting('connectionRetryTime', 5000);

		if(timeout && timeout > 0) {
			console.error('[ERROR]  IMAP Connection error ' + err + '. ' +
				'Attempting to reconnect in ' + timeout + ' milliseconds.');
			setTimeout(function() { NodeSavings._imap.connect(); }, timeout);
		} else {
			NodeSavings.terminate('IMAP Connection Error: ' + err);
		}
    },

	/**
	 * IMAP Callback when the connection is closing.
	 */
    _imapClosing: function(hadError) {
    	NodeSavings.info('IMAP is closing!');
		NodeSavings.getSetting('postDisconnect', function() { })(hadError);
    },

    /* #########################################################################
     # Helper Methods
     #########################################################################*/

    getConfigFileName: function() {
    	var confFile = './Config';

		// Get commandline argument, if it exists
		if(process.argv && process.argv.length >= 3) {
			confFile = process.argv[2];

			// Remove .js extension if it exists
			confFile = confFile.replace(/^(.*?)\.js$/, '$1');

			// See if we need to add a ./
			if(confFile[0] != '/' && confFile.substr(0, 2) != './') {
				confFile = './' + confFile;
			}
        }

    	return confFile;
    },

    /**
     * Gets the name of the save file.
     * @return the name of the save file.
     */
    getSaveFileName: function() {
        var saveFile = NodeSavings.getSetting('saveFile', 'saveFile');

        // Remove .json extension if it exists
        saveFile = saveFile.replace(/^(.*?)\.json$/, '$1');

        // See if we need to add a ./
        if(saveFile[0] != '/' && saveFile.substr(0, 2) != './') {
            saveFile = './' + saveFile;
        }

        return saveFile + '.json';
    },

	/**
	 * Checks if the from header of the given message info is within the given
	 * array of email addresses or names.
	 * @param msgInfo - The message info object
	 * @param fromList - The array of email addresses or names
	 * @return true if the email in the from header is in the fromList
	 */
    checkFrom: function(msgInfo, fromList) {
    	// Get the message from header and parse out the name and email
    	if(msgInfo.header && msgInfo.header.from) {
    		var fromHeader = msgInfo.header.from;
    		var regex = /(.*?) <(.*?)>/gi.exec(fromHeader);
    		var name = (regex) ? regex[1] : null;
    		var address = (regex) ? regex[2] : null;

			// Try every item in the fromList
    		for(var i in fromList) {
    			if(fromHeader == fromList[i] ||
    				(name && name == fromList[i]) ||
    				(address && address == fromList[i])
    			) {
    				return true;
    			}
    		}
    	} else {
    		console.warn('[WARNING] Skipping message without a from header.');
    	}

    	return false;
    },

    /**
     * Gets a setting from the setting object.
     * @param setting - The setting name to get
     * @param defval - The default value if the setting does not exist
     * @return the setting value from the settings object, if it exists.
     *     Otherwise it uses {defval}.
     */
    getSetting: function(setting, defval) {
        return (NodeSavings.settings && NodeSavings.settings[setting]) ?
            NodeSavings.settings[setting] : defval;
    },

    /**
     * Trys to load the given module and reterns it if successful. Otherwise
     * the application exits with the given fatal error message.
     * @param module - The module to try and load
     * @param msg - The message to print before terminating. If null, the
     *     exception will be printed.
     * @param printException - If an exception is encountered, print it before
     *     terminating
     * @return the module object
     */
    getModule: function(module, msg, printException) {
        try {
            return require(module);
        } catch(e) {
            if(!msg) {
                msg = e;
            } else if(printException) {
                msg + "\n" + e;
            }
            NodeSavings.terminate(msg, 1);
        }
    },

	/**
	 * Prints a debug message to the console if debugging is enabled.
	 */
    info: function(msg) {
    	if(NodeSavings._debug) {
    		console.log('[INFO] ' + msg);
    	}
    },

    /**
     * Terminates the application with the given error message and code.
     * @param msg - The message to print to console before terminating
     * @param code - The exit code to send back to the shell
     */
    terminate: function(msg, code) {
    	if(NodeSavings._imap && NodeSavings._imap.state != 'disconnected') {
			NodeSavings._imap.end();
    	}
        console.error('[FATAL ERROR] ' + msg);
        process.exit((code) ? code : 1);
    }
};

// Kick it all off!
NodeSavings.init();