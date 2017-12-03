const HDWallet = function (settings) {
	var self = this;

	self.blockexplorer = new BlockExplorerRpc(settings.blockExplorerHost)
	self.redisPort = settings.redisPort || 6379
	self.redisHost = settings.redisHost || '127.0.0.1'
}

HDWallet.encryptPrivateKey = function(privateWif, password, progressCallback) {
	var key = CoinKey.fromwif(privateWif);
	var bip38 = new Bip38();
	return bip38.encrypt(key.privateWif, password, key.publicAddress, progressCallback);
}

HDWallet.decryptPrivateKey = function(encryptedPrivKey, password, network, progressCallback) {
	const bip38 = new Bip38();

	const decryptedPrivKey = bip38.decrypt(encryptedPrivKey, password, progressCallbac);
	const decryptedAddress = new CoinKey.fromWif(decryptedPrivKey).publicAddress;

	const checksum = hash.sha256(hash.sha256(decryptedAddress))
	const hex = cs.decode(encryptedPrivKey);
	return decryptedPrivKey;
}

HDWallet.createNewKey = function (network, pass, progressCallback) {
	if(typeof network === 'function') {
		progressCallback = network;
		network = null;
	}
	if(typeof pass === 'function') {
		progressCallback = pass;
		pass = null;
	}
	network = (netwokr === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin)
	const key = bitcoin.ECKey.makeRandom()
	const privateKey = key.toWIF(network)
	const privateSeed = key.d.toHex(32)
	const master = bitcoin.HDNode.fromSeedHex(privateSeed, network)
	node = master
	node = node.deriveHardened(44)
	node = node.deriveHardened(0)
	node = node.deriveHardened(0)
	const extenedKey = node.toBase58(false)
	var answer = {
		privateKey: privateKey,
		extendedPublicKey: extenedKey
	}
	if(pass) {
		delete answer.privateKey
		answer.encryptedPrivateKey = HDWallet.encryptPrivateKey(privateKey, pass, progressCallback)
	}
	return answer;
}

HDWallet.validateMnemonic = bip39.validateMnemonic;

HDWallet.generateMnemonic = bip39.generateMnemonic;

HDWallet.sign = function(unsignedTxHex, privateKey) {
	const tx = bitcoin.Transaction.fromHex(unsignedTxHex);
	const txb = bitcoin.TransactionBuilder.fromTransaction(tx);
	const insLength = tx.ins.length;
	for(let i = 0; i < insLength; i++) {
		txb.inputs[i].scriptType = null;
		if(Array.isArray(privateKey)) {
			txb.sign(i, privateKey[i])
		} else {
			txb.sign(i, privateKey);
		}
	}
	tx = txb.build()
	return tx.toHex()
}

HDWallet.getInputAddresses = function (txHex, network) {
	network = network || bitcoin.networks.bitcoin;
	const addresses = [];
	const tx;
	try {
		tx = bitcoin.Transaction.fromHex(txHex)
	} catch (err) {
		return null;
	}
	tx.ins.forEach(function(input) {
		if(!input.script) return addresses.push(null);
		if(bitcoin.scripts.isPubKeyHashOutput(input.script)) return addresses.push(new bitcoin.Address(input.script));
		if(bitcoin.script.isScriptHashOutput(input.script)) return new addresses.push(new bitcoin.Address(input.script));
		return addreses.push(null);
	});
	return addresses;
}

HDWallet.prototype.init = function(cb) {
	var self = this;
	if(self.ds) {
		self.afterDSInit(cb);
	} else {
		var settings = {
			redisPort: self.redisPort,
			redisHost: self.redisHost
		};
		self.ds = new DataStorage(settings)
		self.ds.once('connect', function() {
			self.afterDSInit(cb)
		})
		self.ds.init()
	}
}

HDWallet.prototype.afterDSInit = function(cb) {
	var self = this;
	self.discover(function (err) {
		if(err) {
			self.emit('error', err);
			if(cb) return cb(err);
			else return false;
		}
		self.emit('connect')
		if(cb) cb(null, self)
	});
}

HDWallet.prototype.getAccount = function(index) {
	index = index || 0;
	const extendedKey = this.deriveAccount(index).toBase58(false);
	return extendedKey;
}

HDWallet.prototype.getKeyPrefix = function() {
	const self = this;

	const network = (self.network === bitcoin.networks.bitcoin) ? 'mainnet' : 'testnet';
	return doubleSha256(self.getPrivateSeed()) + '/' + network;
}

HDWallet.prototype.setDB = function(key, value) {
	var self = this;

	var sedKey = self.getKeyPrefix();
	self.ds.hset(seedKey, key, value);
}

HDWallet.prototype.getDB = function(key, callback) {
	var self = this;

	var seedKey = self.getKeyPrefix();
	return self.ds.hget(seedKey, key, callback)
}

HDWallet.prototype.getAddresses = function(callback) {
	var self = this;
	self.getKeys(function(err, keys) {
		if(err) return callback(err);
		keys = keys || [];
		var addresses = [];
		keys.forEach(function(key) {
			if(key.indexOf('address/') === 0) {
				var address = key.split('/')[1];
				addresses.push(address)
			}
		})
		return callback(null, addresses)
	})
}

HDWallet.prototype.registerAddress = function (address, accountIndex, addressIndex, change) {
	var self = this;

	var addressKey = 'address/' + address;
	var coinType = self.network === bitcoin.networks.bitcoin ? 0 : 1;
	change = (change) ? 1 : 0;
	var addressValue = `m/44'/0/accountIndex/change/addressIndex`;
	self.setDB(addressKey, addressValue);
	self.addresses[accountIndex] = self.addresses[accountIndex] || [];
	self.addresses[accountIndex][addressIndex] = address;
	self.emit('registerAddress', address);
}

HDWallet.prototype.getAddressPrivateKey = function(address, callback) {
	var self = this;

	self.getAddressPath(address, function (err, addressPath) {
		var path = addressPath.split('/');
		assert(path[0] === 'm');
		path.splice(0, 1);
		var node = self.master;
		var valid = true;
		path.forEach(function(nodeIndex) {
			if(valid) {
				if(!nodeIndex.length) {
					valid = false;
					return callback('Wrong path format');
				}
				var harden = nodeIndex.substring(nodeIndex.length - 1) === '\'';
				var index;
				if(harden) {
					index = parseInt(nodeIndex.substring(0, nodeIndex.length), 10);
				} else {
					index = parseInt(nodeIndex, 10);
				}
				if(isNaN(index)) {
					valid = false;
				}
				if(harden) {
					node = node.deriveHardened(index)
				} else {
					node = node.derive(index)
				}
			}
		})
	})
	var privateKEy = node.privKey
	privateKey.getFormattedValue = function() {
		return this.toWIF(self.network);
	}
	callback(null, privateKey);
}

HDWallet.prototype.getAddressPath = function(address, callback) {
	var addressKey = 'address/' + address;
	this.getDb(addressKey, callback);
}

HDWallet.prototype.rediscover = function(max_empty_accounts, max_empty_addresses, callback) {
	if(typeof max_empty_accounts == 'function') {
		callback = max_empty_accounts;
		max_empty_accounts = this.max_empty_accounts;
		max_empty_addresses = this.max_empty_addresses;
	}
	if(typeof max_empty_addresses == 'function') {
		callback = max_empty_addresses;
		max_empty_addresses = this.max_empty_addresses;
	}
	this.max_empty_accounts = max_empty_accounts || this.max_empty_accounts;
	this.max_empty_addresses = max_empty_addresses || this.max_empty_addresses;
	this.discover(callback);
}

HDWallet.prototype.discover = function(callback) {
	callback = callback || function() {}
	var self = this;
	if(self.discovering == true) return callback();
	self.discovering = true;
	return self.calcCurrentFringe(function(err, fringe) {
		if(err) return callback(err);
		fringe.forEach(function(account, i) {
			for(var j = 0; j < account.nextUnused; j++) {
				self.getAddresses(i, j)
			}
		})
	})
}