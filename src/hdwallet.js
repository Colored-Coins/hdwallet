// var assert = require('assert')
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

var mainnetColuHost = 'https://engine.colu.co'
var testnetColuHost = 'https://testnet.engine.colu.co'

var HDWallet = function (settings) {
  var self = this

  settings = settings || {}
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
  self.fs = new FileSystem()
  if (!privateSeed) {
    self.privateSeed = crypto.randomBytes(32)
    self.needToDiscover = false
  } else {
    self.privateSeed = new Buffer(privateSeed, 'hex')
    self.needToDiscover = true
  }
  self.master = bitcoin.HDNode.fromSeedHex(self.privateSeed, self.network)
  self.nextAccount = 0
}

util.inherits(HDWallet, events.EventEmitter)

HDWallet.prototype.init = function (cb) {
  var self = this

  self.redisClient = redis.createClient(self.redisPort, self.redisHost)
  self.redisClient.on('error', function (err) {
    if (err) console.error('Redis err: ' + err)
    self.redisClient.end()
    self.hasRedis = false
    self.fs = new FileSystem()
    self.afterRedisInit(cb)
  })
  self.redisClient.on('connect', function () {
    // console.log('redis connected!')
    self.hasRedis = true
    self.afterRedisInit(cb)
  })
}

HDWallet.prototype.afterRedisInit = function (cb) {
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

HDWallet.prototype.getSavedKey = function (key, callback) {
  var self = this

  var savedKey = self.getKeyPrefix() + '/' + key
  if (self.hasRedis) {
    return self.redisClient.get(savedKey, function (err, value) {
      if (err) return callback(err)
      return callback(null, value)
    })
  } else if (self.fs) {
    return callback(null, self.fs.get(savedKey))
  } else {
    return callback('Key ' + key + ' not found.')
  }
}

HDWallet.prototype.getNextAccount = function (callback) {
  var self = this

  var coluSdkNextAccount = self.getKeyPrefix() + '/coluSdkNextAccount'
  if (self.hasRedis) {
    return self.redisClient.get(coluSdkNextAccount, function (err, nextAccount) {
      if (err) return callback(err)
      if (nextAccount)
        nextAccount = parseInt(nextAccount)
      return callback(null, nextAccount)
    })
  } else if (self.fs) {
    var nextAccount = self.fs.get(coluSdkNextAccount) || 0
    if (nextAccount)
      nextAccount = parseInt(nextAccount)
    return callback(null, nextAccount)
  } else {
    return callback(null, self.nextAccount)
  }
}

HDWallet.prototype.getNextAccountAddress = function (accountIndex, callback) {
  var self = this

  var coluSdkNextAccountAddress = self.getKeyPrefix() + '/coluSdknextAccountAddress/'+accountIndex
  if (self.hasRedis) {
    return self.redisClient.get(coluSdkNextAccountAddress, function (err, nextAccountAddress) {
      if (err) return callback(err)
      if (nextAccountAddress)
        nextAccountAddress = parseInt(nextAccountAddress)
      return callback(null, nextAccountAddress)
    })
  } else if (self.fs) {
    var nextAccountAddress = self.fs.get(coluSdkNextAccountAddress) || 0
    if (nextAccountAddress)
      nextAccountAddress = parseInt(nextAccountAddress)
    return callback(null, nextAccountAddress)
  } else {
    return callback(null, 0)
  }
}

HDWallet.prototype.setNextAccount = function (nextAccount) {
  var self = this

  var coluSdkNextAccount = self.getKeyPrefix() + '/coluSdkNextAccount'
  self.nextAccount = nextAccount
  self.setDB(coluSdkNextAccount, self.nextAccount)
}

HDWallet.prototype.setNextAccountAddress = function (accountIndex, nextAccountAddress) {
  var self = this

  var coluSdkNextAccountAddress = self.getKeyPrefix() + '/coluSdknextAccountAddress/'+accountIndex
  self.setDB(coluSdkNextAccountAddress, nextAccountAddress)
}

HDWallet.prototype.registerAddress = function (address, accountIndex, addressIndex, change) {
  var self = this

  // console.log('registering '+address)
  change = (change) ? 1 : 0
  var addressKey = self.getKeyPrefix() + '/' + address
  var addressValue = 'm/44\'/0\'/' + accountIndex + '\'/' + change + '/' + addressIndex
  self.setDB(addressKey, addressValue)
}

HDWallet.prototype.setDB = function (key, value) {
  var self = this

  if (self.hasRedis) {
    self.redisClient.set(key, value)
  } else {
    if (self.fs) {
      self.fs.set(key, value)
    }
  }
}

HDWallet.prototype.getAddressPrivateKey = function (address, callback) {
  var self = this

  self.getAddressPath(address, function (err, addressPath) {
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
  this.getSavedKey(address, callback)
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
            }
            else {
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
            }
            else {
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
