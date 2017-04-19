// JSON Server Configuration System
// Loads config file and command-line arguments
// Copyright (c) 2014 Joseph Huckaby
// Released under the MIT License

var fs = require("fs");
var cp = require("child_process");
var dns = require("dns");
var os = require('os');

var Class = require("pixl-class");
var Args = require("pixl-args");
var Tools = require("pixl-tools");

var Config = module.exports = Class.create({
	
	configFile: "",
	config: null,
	args: null,
	subs: null,
	
	watch: false,
	watcher: null,
	hostname: '',
	ip: '',
	
	__construct: function(thingy, watch, isa_sub) {
		// class constructor
		if (thingy) {
			if (typeof(thingy) == 'string') this.configFile = thingy;
			else {
				this.config = thingy;
				this.configFile = "";
			}
		}
		if (watch) this.watch = watch;
		
		if (this.configFile) this.load();
		else if (!isa_sub) this.loadArgs();
		
		this.subs = {};
	},
	
	load: function() {
		// load config and merge in cmdline
		var self = this;
		this.config = {};
		
		var config = JSON.parse( 
			fs.readFileSync( this.configFile, { encoding: 'utf8' } ) 
		);
		for (var key in config) {
			this.config[key] = config[key];
		}
		
		// cmdline args (--key value)
		this.loadArgs();
		
		// watch file for changes
		this.watchFile();
	},
	
	loadArgs: function() {
		// merge in cmdline args (--key value)
		var args = this.args = new Args();
		for (var key in args.get()) {
			this.config[key] = args.get(key);
		}
	},
	
	watchFile: function() {
		// setup watcher for live changes
		var self = this;
		
		if (this.watch) {
			// persistent means process cannot exit while watcher is live -- set to false
			var opts = { persistent: false, recursive: false };
			
			this.watcher = fs.watch( this.configFile, opts, function(event_type, filename) {
				// file has changed on disk, reload it async
				fs.readFile( self.configFile, { encoding: 'utf8' }, function(err, data) {
					// fs read complete
					if (err) {
						self.emit('error', "Failed to reload config file: " + self.configFile + ": " + err);
						self.watchFile();
						return;
					}
					
					// now parse the JSON
					var config = null;
					try {
						config = JSON.parse( data );
					}
					catch (err) {
						self.emit('error', "Failed to parse config file: " + self.configFile + ": " + err);
						self.watchFile();
						return;
					}
					
					// replace master copy
					self.config = config;
					
					// re-merge in cli args
					for (var key in self.args.get()) {
						self.config[key] = self.args.get(key);
					}
					
					// emit event for listeners
					self.emit('reload');
					
					// refresh subs
					self.refreshSubs();
					
					// cleanup (prevents leak)
					self.watcher.close();
					
					// reinstate fs.watch (required because INODE changes if file was atomically written)
					self.watchFile();
				} ); // fs.readFile
			} ); // fs.watch
		} // watch
	},
	
	get: function(key) {
		// get single key or entire config hash
		return key ? this.config[key] : this.config;
	},
	
	set: function(key, value) {
		// set config value
		this.config[key] = value;
		
		// also set it in this.args so a file reload won't clobber it
		if (this.args) this.args.set(key, value);
	},
	
	getSub: function(key) {
		// get cloned Config object pointed at sub-key
		var sub = new Config( this.get(key) || {}, null, true );
		
		// keep track so we can refresh on reload
		this.subs[key] = sub;
		
		return sub;
	},
	
	refreshSubs: function() {
		// refresh sub key objects on a reload
		for (var key in this.subs) {
			var sub = this.subs[key];
			sub.config = this.get(key) || {};
			sub.emit('reload');
			sub.refreshSubs();
		}
	},
	
	getEnv: function(callback) {
		// determine environment (hostname and ip) async
		var self = this;
		
		// get hostname and ip (async ops)
		self.getHostname( function(err) {
			if (err) callback(err);
			else {
				self.getIPAddress( callback );
			}
		} );
	},
	
	getHostname: function(callback) {
		// determine server hostname
		this.hostname = (process.env['HOSTNAME'] || process.env['HOST'] || '').toLowerCase();
		if (this.hostname) {
			// well that was easy
			callback();
			return;
		}
		
		// try the OS module
		this.hostname = os.hostname().toLowerCase();
		if (this.hostname) {
			// well that was easy
			callback();
			return;
		}
		
		// sigh, the hard way (exec hostname binary)
		var self = this;
		child = cp.execFile('/bin/hostname', function (error, stdout, stderr) {
			self.hostname = stdout.toString().trim().toLowerCase();
			if (!self.hostname) {
				callback( new Error("Failed to determine server hostname via /bin/hostname") );
			}
			else callback();
		} );
	},
	
	getIPAddress: function(callback) {
		// determine server ip address
		var self = this;
		
		// try OS networkInterfaces() first
		// find the first external IPv4 address
		var ifaces = os.networkInterfaces();
		var addrs = [];
		for (var key in ifaces) {
			addrs = addrs.concat( addrs, ifaces[key] );
		}
		var addr = Tools.findObject( addrs, { family: 'IPv4', internal: false } );
		if (addr && addr.address && addr.address.match(/^\d+\.\d+\.\d+\.\d+$/)) {
			// well that was easy
			this.ip = addr.address;
			callback();
			return;
		}
		
		// sigh, the hard way (DNS resolve the server hostname)
		dns.resolve4(this.hostname, function (err, addresses) {
			// if (err) callback(err);
			self.ip = addresses ? addresses[0] : '127.0.0.1';
			callback();
		} );
	}
	
});
