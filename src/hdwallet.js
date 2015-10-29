// var assert = require('assert')
var async = require('async')
var util = require('util')
var events = require('events')
var request = require('request')
var bitcoin = require('bitcoinjs-lib')
var crypto = require('crypto')
var CoinKey = require('coinkey')
var Bip38 = require('bip38')
var cs = require('coinstring')
var hash = require('crypto-hashing')
var crypto = require('crypto')

var DataStorage = require('data-storage')

var MAX_EMPTY_ACCOUNTS = 3
var MAX_EMPTY_ADDRESSES = 3

var mainnetColuHost = 'https://engine.colu.co'
var testnetColuHost = 'https://testnet.engine.colu.co'

var HDWallet = function (settings) {
  var self = this

  settings = settings || {}
  if (settings.network === 'testnet') {
    self.coluHost = settings.coluHost || testnetColuHost
    self.network = bitcoin.networks.testnet
  } else {
    self.coluHost = settings.coluHost || mainnetColuHost
    self.network = bitcoin.networks.bitcoin
  }
  self.redisPort = settings.redisPort || 6379
  self.redisHost = settings.redisHost || '127.0.0.1'
  var privateSeed = settings.privateSeed || null
  if (settings.privateKey) {
    self.masterPrivateKey = settings.privateKey
    privateSeed = settings.privateKey
    if (!Buffer.isBuffer(privateSeed)) {
      privateSeed = new Buffer(privateSeed)
    }
    privateSeed = crypto.createHash('sha256').update(privateSeed).digest()
    privateSeed = crypto.createHash('sha256').update(privateSeed).digest('hex')
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
  if (settings.ds) {
    self.ds = settings.ds
  }
}

util.inherits(HDWallet, events.EventEmitter)

HDWallet.encryptPrivateKey = function (privateWif, password, progressCallback) {
  var key = CoinKey.fromWif(privateWif)
  var bip38 = new Bip38()
  return bip38.encrypt(key.privateWif, password, key.publicAddress, progressCallback)
}

HDWallet.decryptPrivateKey = function (encryptedPrivKey, password, progressCallback) {
  var bip38 = new Bip38()
  var decrypedPrivKey = bip38.decrypt(encryptedPrivKey, password, progressCallback)
  var decryptedAddress = new CoinKey.fromWif(decrypedPrivKey).publicAddress

  var checksum = hash.sha256(hash.sha256(decryptedAddress))
  var hex = cs.decode(encryptedPrivKey)
  if (
     checksum[0] === hex[3] &&
     checksum[1] === hex[4] &&
     checksum[2] === hex[5] &&
     checksum[3] === hex[6]
    ) {
    return decrypedPrivKey
  }
  return false
}

HDWallet.createNewKey = function (network, pass, progressCallback) {
  if (typeof network === 'function') {
    progressCallback = network
    network = null
  }
  if (typeof pass === 'function') {
    progressCallback = pass
    pass = null
  }
  network = (network === 'testnet' ? bitcoin.networks.testnet : bitcoin.networks.bitcoin)
  var key = bitcoin.ECKey.makeRandom()
  var privateKey = key.toWIF(network)
  var buffer = new Buffer(privateKey)
  var privateSeed = crypto.createHash('sha256').update(buffer).digest()
  privateSeed = crypto.createHash('sha256').update(privateSeed).digest('hex')
  var master = bitcoin.HDNode.fromSeedHex(privateSeed, network)
  var extendedKey = deriveAccount(master, 0).toBase58(false)
  var answer = {
    privateKey: privateKey,
    extendedPublicKey: extendedKey
  }
  if (pass) {
    delete answer.privateKey
    answer.encryptedPrivateKey = HDWallet.encryptPrivateKey(privateKey, pass, progressCallback)
  }
  return answer
}

HDWallet.prototype.init = function (cb) {
  var self = this
  if (self.ds) {
    self.afterDSInit(cb)
  } else {
    var settings = {
      redisPort: self.redisPort,
      redisHost: self.redisHost
    }
    self.ds = new DataStorage(settings)
    self.ds.once('connect', function () {
      self.afterDSInit(cb)
    })
    self.ds.init()
  }
}

HDWallet.prototype.afterDSInit = function (cb) {
  var self = this
  if (self.needToDiscover) {
    self.discover(function (err) {
      if (err) {
        self.emit('error', err)
        if (cb) return cb(err)
        else return false
      }
      self.emit('connect')
      if (cb) cb(null, self)
    })
  } else {
    self.emit('connect')
    if (cb) return cb(null, self)
  }
}

HDWallet.prototype.getKeyPrefix = function () {
  var self = this

  var network = (self.network === bitcoin.networks.bitcoin) ? 'mainnet' : 'testnet'
  return doubleSha256(self.getPrivateSeed()) + '/' + network
}

HDWallet.prototype.setDB = function (key, value) {
  var self = this

  var seedKey = self.getKeyPrefix()
  self.ds.hset(seedKey, key, value)
}

HDWallet.prototype.getDB = function (key, callback) {
  var self = this

  var seedKey = self.getKeyPrefix()
  return self.ds.hget(seedKey, key, callback)
}

HDWallet.prototype.getKeys = function (callback) {
  var self = this

  var seedKey = self.getKeyPrefix()
  return self.ds.hkeys(seedKey, callback)
}

HDWallet.prototype.getAddresses = function (callback) {
  var self = this

  self.getKeys(function (err, keys) {
    if (err) return callback(err)
    var addresses = []
    keys.forEach(function (key) {
      if (key.indexOf('address/') === 0) {
        var address = key.split('/')[1]
        addresses.push(address)
      }
    })
    return callback(null, addresses)
  })
}

HDWallet.prototype.getNextAccount = function (callback) {
  var self = this

  var coluSdkNextAccount = 'coluSdkNextAccount'
  self.getDB(coluSdkNextAccount, function (err, nextAccount) {
    if (err) return callback(err)
    nextAccount = nextAccount || 0
    return callback(null, parseInt(nextAccount, 10))
  })
}

HDWallet.prototype.getNextAccountAddress = function (accountIndex, callback) {
  var self = this

  var coluSdkNextAccountAddress = 'coluSdknextAccountAddress/' + accountIndex
  self.getDB(coluSdkNextAccountAddress, function (err, nextAccountAddress) {
    if (err) return callback(err)
    nextAccountAddress = nextAccountAddress || 0
    return callback(null, parseInt(nextAccountAddress, 10))
  })
}

HDWallet.prototype.setNextAccount = function (nextAccount) {
  var self = this

  var coluSdkNextAccount = 'coluSdkNextAccount'
  self.nextAccount = nextAccount
  self.setDB(coluSdkNextAccount, self.nextAccount)
}

HDWallet.prototype.setNextAccountAddress = function (accountIndex, nextAccountAddress) {
  var self = this

  var coluSdkNextAccountAddress = 'coluSdknextAccountAddress/' + accountIndex
  self.setDB(coluSdkNextAccountAddress, nextAccountAddress)
}

HDWallet.prototype.registerAddress = function (address, accountIndex, addressIndex, change) {
  var self = this

  // console.log('registering '+address)

  var addressKey = 'address/' + address
  change = (change) ? 1 : 0
  var addressValue = 'm/44\'/0\'/' + accountIndex + '\'/' + change + '/' + addressIndex
  self.setDB(addressKey, addressValue)
}

HDWallet.prototype.getAddressPrivateKey = function (address, callback) {
  var self = this

  var addressKey = 'address/' + address
  self.getAddressPath(addressKey, function (err, addressPath) {
    if (err) return callback(err)
    if (!addressPath) return callback('Addresss ' + address + ' privateKey not found.')
    var path = addressPath.split('/')
    if (!path.length || path[0] !== 'm') {
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
        var harden = nodeIndex.substring(nodeIndex.length - 1) === '\''
        var index
        if (harden) {
          index = parseInt(nodeIndex.substring(0, nodeIndex.length), 10)
        } else {
          index = parseInt(nodeIndex, 10)
        }
        if (isNaN(index)) {
          valid = false
          return callback('Wrong path format')
        }
        if (harden) {
          node = node.deriveHardened(index)
        } else {
          node = node.derive(index)
        }
      }
    })
    var privateKey = node.privKey
    callback(null, privateKey)
  })
}

HDWallet.prototype.getAddressPath = function (address, callback) {
  this.getDB(address, callback)
}

HDWallet.prototype.discover = function (callback) {
  var self = this

  self.getNextAccount(function (err, nextAccount) {
    if (err) return callback(err)
    self.nextAccount = nextAccount || 0
    var emptyAccounts = 0
    var currentAccount = nextAccount || 0

    async.whilst(
      function () { return emptyAccounts < MAX_EMPTY_ACCOUNTS },
      function (cb) {
        async.times(MAX_EMPTY_ACCOUNTS - emptyAccounts, function (accountIndexDelata, cb) {
          var accountIndex = currentAccount + accountIndexDelata
          // console.log('discovering account '+accountIndex)
          self.discoverAccount(accountIndex, cb)
        },
        function (err, actives) {
          if (err) return callback(err)
          actives.forEach(function (isActive) {
            if (isActive) {
              self.setNextAccount(currentAccount + 1)
              emptyAccounts = 0
            } else {
              emptyAccounts++
            }
            currentAccount++
          })
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

  self.getNextAccountAddress(accountIndex, function (err, nextAccountAddress) {
    if (err) return callback(err)
    var emptyAddresses = 0
    var currentAddress = nextAccountAddress || 0
    var active = false

    async.whilst(
      function () { return emptyAddresses < MAX_EMPTY_ADDRESSES },
      function (cb) {
        async.times(MAX_EMPTY_ADDRESSES - emptyAddresses, function (addressIndexDelata, cb) {
          var addressIndex = currentAddress + addressIndexDelata
          self.discoverAddress(accountIndex, addressIndex, cb)
        },
        function (err, addresses) {
          if (err) return callback(err)
          addresses.forEach(function (address) {
            if (address && address.length && address[0].active) {
              self.setNextAccountAddress(accountIndex, currentAddress + 1)
              emptyAddresses = 0
              active = true
            } else {
              emptyAddresses++
            }
            currentAddress++
          })
          cb()
        })
      },
      function (err) {
        if (err) return callback(err)
        callback(null, active)
      }
    )
  })
}

HDWallet.prototype.discoverAddress = function (accountIndex, addressIndex, interval, callback) {
  var self = this

  var addresses = []
  if (typeof interval === 'function') {
    callback = interval
    interval = 1
  }
  for (var i = 0; i < interval; i++) {
    var hdnode = deriveAddress(self.master, accountIndex, addressIndex++)
    var address = hdnode.getAddress().toString()
    self.registerAddress(address, accountIndex, addressIndex - 1)
    addresses.push(address)
    // console.log('discovering address: ' + address)
  }
  self.isAddressActive(addresses, callback)
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
  return this.privateSeed.toString('hex')
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

  return publicKey
}

HDWallet.prototype.getAddress = function (account, addressIndex) {
  var self = this

  return self.getPublicKey(account, addressIndex).getAddress(self.network).toString()
}

HDWallet.prototype.isAddressActive = function (addresses, callback) {
  var self = this

  if (typeof addresses === 'string') addresses = [addresses]
  request.post(self.coluHost + '/is_addresses_active',
    {json: {addresses: addresses}},
    function (err, response, body) {
      if (err) {
        return callback(err)
      }
      if (response.statusCode !== 200) {
        return callback(body)
      }
      if (!body) return callback('Empty response from Colu server.')
      return callback(null, body)
    }
  )
}

var deriveAddress = function (master, accountIndex, addressIndex) {
  var node = deriveAccount(master, accountIndex)

  node = node.derive(0)
  // address_index
  node = node.derive(addressIndex)

  return node
}

var deriveAccount = function (master, accountIndex) {
  var node = master
  // BIP0044:
  // purpose'
  node = node.deriveHardened(44)
  // coin_type'
  node = node.deriveHardened(0)
  // account'
  node = node.deriveHardened(accountIndex)

  return node
}

var doubleSha256 = function (message) {
  var sha = crypto.createHash('sha256').update(message).digest()
  sha = crypto.createHash('sha256').update(sha).digest()
  return sha
}

module.exports = HDWallet
