var assert = require('assert')
var async = require('async')
var util = require('util')
var events = require('events')
var request = require('request')
var bitcoin = require('bitcoinjs-lib')
var crypto = require('crypto')
var redis = require('redis')

var FileSystem = require('./filesystem.js')

var MAX_EMPTY_ACCOUNTS = 3
var MAX_EMPTY_ADDRESSES = 3
var ASKING_INTERVAL = 4

var coluHost = 'https://dev.engine.colu.co'

var HDWallet = function (args) {
  var self = this

  args = args || {}
  self.redisPort = args.redisPort || 6379
  self.redisHost = args.redisHost || '127.0.0.1'
  var network = args.network || null
  var privateSeed = args.privateSeed || null
  
  self.coluHost = coluHost
  
  self.fs = new FileSystem()
  if (network && network.toLowerCase() == 'testnet') {
    self.network = bitcoin.networks.testnet
  } else {
    self.network = bitcoin.networks.bitcoin
  }
  if (!privateSeed) {
    self.privateSeed = crypto.randomBytes(32)
    self.needToDiscover = false
  } else {
    self.privateSeed = new Buffer(privateSeed, 'hex')
    self.needToDiscover = true
  }
  self.master = bitcoin.HDNode.fromSeedHex(self.privateSeed, self.network)
  self.nextAccount = 0
  self.hdwallet = {}
}

util.inherits(HDWallet, events.EventEmitter)

HDWallet.prototype.init = function () {
	var self = this

  self.redisClient = redis.createClient(self.redisPort, self.redisHost)
  self.redisClient.on('error', function (err) {
    // console.error('Redis err: ' + err)
    self.redisClient.end()
    self.hasRedis = false
    self.afterRedisInit()
  })
  self.redisClient.on('connect', function () {
    // console.log('redis connected!')
    self.hasRedis = true
    self.afterRedisInit()
  })
}

HDWallet.prototype.afterRedisInit = function () {
  var self = this 

  if (self.needToDiscover) {
    self.discover(function (err) {
      if (err) return self.emit('error', err)
      self.emit('connect')
    })
  } else {
    self.emit('connect')
  }
}

HDWallet.prototype.getKeyPrefix = function () {
  var self = this
  var network = (self.network == bitcoin.networks.bitcoin) ? 'mainnet' : 'testnet'
  return doubleSha256(self.getPrivateSeed()) + '/' + network
}

HDWallet.prototype.getSavedKey = function (key, callback) {
  var self = this
  var savedKey = self.getKeyPrefix()+'/'+key
  if (self.hasRedis) {
    return self.redisClient.get(savedKey, function (err, value) {
      if (err) {
        if (self.fs) {
          value = self.fs.get(savedKey)
          return callback(null, value)
        } else {
          return callback('Key '+key+' not found.')
        }
      } else {
        return callback(null, value)
      }
    })
  } else {
    if (self.fs) {
      var value = self.fs.get(savedKey)
      return callback(null, value)
    } else {
      return callback('Key '+key+' not found.')
    }
  }
}

HDWallet.prototype.getNextAccount = function (callback) {
  var self = this

  var coluSdkNextAccount = self.getKeyPrefix()+'/coluSdkNextAccount'
  return self.redisClient.get(coluSdkNextAccount, function (err, nextAccount) {
    if (err) {
      if (self.fs) {
        nextAccount = self.fs.get(coluSdkNextAccount) || 0
        return callback(nextAccount)
      } else {
        return callback(this.nextAccount)
      }
    } else {
      return callback(nextAccount)
    }
  })
}

HDWallet.prototype.setNextAccount = function (nextAccount) {
  var self = this

  var coluSdkNextAccount = self.getKeyPrefix()+'/coluSdkNextAccount'
  self.nextAccount = nextAccount
  if (self.hasRedis) {
    self.redisClient.set(coluSdkNextAccount, self.nextAccount)
  } else {
    if (self.fs) {
      self.fs.set(coluSdkNextAccount, self.nextAccount)
    }
  }
}

HDWallet.prototype.registerAddress = function (address, accountIndex, addressIndex, change) {
  var self = this
  // console.log('registering '+address)
	change = (change) ? 1 : 0
	var addressKey = self.getKeyPrefix()+'/'+address
	var addressValue = 'm/44\'/0\'/'+accountIndex+'\'/'+change+'/'+addressIndex
	if (self.hasRedis) {
    self.redisClient.set(addressKey, addressValue)
  } else {
    if (self.fs) {
      self.fs.set(addressKey, addressValue)
    }
  }
}

HDWallet.prototype.getAddressPrivateKey = function (address, callback) {
	var self = this

	self.getAddressPath(address, function (err, addressPath) {
		if (err) return callback(err)
    if (!addressPath) return callback('Addresss '+address+' privateKey not found.')
		var path = addressPath.split('/')
		if (!path.length || path[0] != 'm') {
			return callback('Wrong path format')
		}
		path.splice(0, 1)
		var node = self.master
		var valid = true
		path.forEach(function (nodeIndex) {
			if (valid) {
				if (!nodeIndex.length) {
					valid = false
					return callback('Wrong path format')
				}
				var harden = nodeIndex.substring(nodeIndex.length-1) == '\''
				var index
				if (harden) {
					index = parseInt(nodeIndex.substring(0, nodeIndex.length))
				}
				else {
					index = parseInt(nodeIndex)	
				}
				if (isNaN(index)) {
					valid = false
					return callback('Wrong path format')	
				}
				if (harden) {
					node = node.deriveHardened(index)
				}
				else {
					node = node.derive(index)
				}
			}
		})
		var privateKey = node.privKey
  	callback(null, privateKey)
	})
}

HDWallet.prototype.getAddressPath = function (address, callback) {
	var self = this

  self.getSavedKey(address, callback)
}

HDWallet.prototype.discover = function (callback) {
  var self = this

  self.getNextAccount(function (nextAccount) {
    self.nextAccount = nextAccount || 0
    var emptyAccounts = 0
    var currentAccount = nextAccount || 0
    async.whilst(
      function () { return emptyAccounts < MAX_EMPTY_ACCOUNTS },
      function (cb) {
        console.log('discovering account: ' + currentAccount)
        self.discoverAccount(currentAccount++, function (err, res) {
          if (err) return cb(err)
          if (res) {
            emptyAccounts = 0
            self.setNextAccount(currentAccount)
          } else {
            emptyAccounts++
          }
          cb()
        })
      },
      function (err) {
        if (err) return callback(err)
        self.needToDiscover = false
        callback()
      }
    )
  })
}

HDWallet.prototype.discoverAccount = function (accountIndex, callback) {
  var self = this

  var emptyAddresses = 0
  var currentAddresses = 0
  var active = false
  async.whilst(
    function () { return emptyAddresses < MAX_EMPTY_ADDRESSES },
    function (cb) {
      self.discoverAddresses(accountIndex, currentAddresses, ASKING_INTERVAL, function (err, res) {
        if (err) return cb(err)
        currentAddresses += ASKING_INTERVAL
        for (var i = 0; i < ASKING_INTERVAL; i++) {
          var address_obj = res[i]
          if (address_obj.active) {
            emptyAddresses = 0
            active = true
            // console.log('active')
          } else {
            emptyAddresses++
            // console.log('inactive')
          }
        }
        cb()
      })
    },
    function (err) {
      return callback(err, active)
    }
  )
}

HDWallet.prototype.discoverAddress = function (accountIndex, addressIndex, callback) {
  var self = this

  var hdnode = deriveAddress(self.master, accountIndex, addressIndex)
  var address = hdnode.getAddress().toString()
  self.registerAddress(address, accountIndex, addressIndex)
  // console.log('discovering address: ' + address)
  self.isAddressActive(address, callback)
}

HDWallet.prototype.discoverAddresses = function (accountIndex, addressIndex, interval, callback) {
  var self = this
  var addresses = []
  for (var i = 0; i < interval; i++) {
    var hdnode = deriveAddress(self.master, accountIndex, addressIndex++)
    var address = hdnode.getAddress().toString()
    self.registerAddress(address, accountIndex, addressIndex)
    addresses.push(address)
    // console.log('discovering address: ' + address)
  }
  self.isAddressesActive(addresses, callback)
}

HDWallet.prototype.registerAccount = function (account) {
  var self = this

  for (var i = 0; i < MAX_EMPTY_ADDRESSES; i++) {
    var hdnode = deriveAddress(self.master, account, i)
    var address = hdnode.getAddress().toString()
    self.registerAddress(address, account, i)
  }
}

HDWallet.prototype.getPrivateSeed = function () {
  var self = this

  return self.privateSeed.toString('hex')
}

HDWallet.prototype.getPrivateKey = function (account, addressIndex) {
  var self = this

  if (typeof account === 'undefined') {
    account = self.nextAccount++
    self.setNextAccount(self.nextAccount)
    self.registerAccount(account)
  }
  addressIndex = addressIndex || 0
  var hdnode = deriveAddress(self.master, account, addressIndex)
  var privateKey = hdnode.privKey
  return privateKey
}

HDWallet.prototype.getPublicKey = function (account, addressIndex) {
  var self = this

  var privateKey = self.getPrivateKey(account, addressIndex)
  var publicKey = privateKey.pub
  self.hdwallet[publicKey.toHex()] = {
    accountIndex: account || self.nextAccount - 1,
    addressIndex: addressIndex || 0
  }
  return publicKey
}

HDWallet.prototype.isAddressActive = function (address, callback) {
  var self = this

  request.post(self.coluHost + '/is_address_active',
    {form: {address: address}},
    function (err, response, body) {
      if (err) {
        return callback(err)
      }
      if (response.statusCode !== 200) {
        return callback(body)
      }
      if (!body) return callback('Empty response from Colu server.')
      body = JSON.parse(body)
      return callback(null, body)
    }
  )
}

HDWallet.prototype.isAddressesActive = function (addresses, callback) {
  var self = this

  request.post(self.coluHost + '/is_addresses_active',
    {form: {addresses: addresses}},
    function (err, response, body) {
      if (err) {
        return callback(err)
      }
      if (response.statusCode !== 200) {
        return callback(body)
      }
      if (!body) return callback('Empty response from Colu server.')
      body = JSON.parse(body)
      return callback(null, body)
    }
  )
}

var deriveAddress = function (master, accountIndex, addressIndex) {
  var node = master
  // BIP0044:
  // purpose'
  node = node.deriveHardened(44)
  // coin_type'
  node = node.deriveHardened(0)
  // account'
  node = node.deriveHardened(accountIndex)
  // change
  node = node.derive(0)
  // address_index
  node = node.derive(addressIndex)

  return node
}

var doubleSha256 = function (message) {
	var sha = crypto.createHash('sha256').update(message).digest()
	sha = crypto.createHash('sha256').update(sha).digest()
	return sha
}

module.exports = HDWallet