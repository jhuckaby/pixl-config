// JSON Server Configuration System
// Loads config file and command-line arguments
// Copyright (c) 2014 Joseph Huckaby
// Released under the MIT License

var fs = require("fs");
var cp = require("child_process");
var dns = require("dns");

var Class = require("pixl-class");
var Args = require("pixl-args");

module.exports = Class.create({
	
	configFile: "conf/config.json",
	config: null,
	args: null,
	
	watch: false,
	watcher: null,
	hostname: '',
	ip: '',
	
	__construct: function(file, watch) {
		// class constructor
		if (file) this.configFile = file;
		if (watch) this.watch = watch;
		
		if (this.configFile) this.load();
		else this.config = {};
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
		var args = this.args = new Args();
		for (var key in args.get()) {
			this.config[key] = args.get(key);
		}
		
		this.watchFile();
	},
	
	watchFile: function() {
		// setup watcher for live changes
		var self = this;
		
		if (this.watch) {
			// persistent means process cannot exit while watcher is live -- set to false
			var opts = { persistent: false, recursive: false };
			
			this.watcher = fs.watch( this.configFile, opts, function() {
				// file has changed on disk, reload it async
				fs.readFile( self.configFile, { encoding: 'utf8' }, function(err, data) {
					// fs read complet
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
					
					// reinstate fs.watch
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
		this.hostname = process.env['HOSTNAME'] || process.env['HOST'] || '';
		if (this.hostname) {
			// well that was easy
			callback();
			return;
		}
		
		// sigh, the hard way
		var self = this;
		child = cp.execFile('/bin/hostname', function (error, stdout, stderr) {
			self.hostname = stdout.toString().trim();
			if (!self.hostname) {
				callback( new Error("Failed to determine server hostname via /bin/hostname") );
			}
			else callback();
		} );
	},
	
	getIPAddress: function(callback) {
		// determine server ip address
		var self = this;
		
		dns.resolve4(this.hostname, function (err, addresses) {
			// if (err) callback(err);
			self.ip = addresses ? addresses[0] : '127.0.0.1';
			callback();
		} );
	}
	
});
