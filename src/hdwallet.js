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

var coluHost = 'https://dev.engine.colu.co'

var HDWallet = function (args) {
  args = args || {}
  this.redisPort = args.redisPort || 6379
  this.redisHost = args.redisHost || '127.0.0.1'
  var network = args.network || null
  var privateSeed = args.privateSeed || null
  this.coluHost = coluHost
  this.fs = new FileSystem()
  if (network && network.toLowerCase() === 'testnet') {
    this.network = bitcoin.networks.testnet
  } else {
    this.network = bitcoin.networks.bitcoin
  }
  if (!privateSeed) {
    this.privateSeed = crypto.randomBytes(32)
    this.needToDiscover = false
  } else {
    this.privateSeed = new Buffer(privateSeed, 'hex')
    this.needToDiscover = true
  }
  this.master = bitcoin.HDNode.fromSeedHex(this.privateSeed, this.network)
  this.nextAccount = 0
  this.hdwallet = {}
}

util.inherits(HDWallet, events.EventEmitter)

HDWallet.prototype.init = function () {
  var self = this
  this.redisClient = redis.createClient(this.redisPort, this.redisHost)
  this.redisClient.on('error', function (err) {
    if (err) console.error('Redis err: ' + err)
    self.redisClient.end()
    self.hasRedis = false
    self.afterRedisInit()
  })
  this.redisClient.on('connect', function () {
    // console.log('redis connected!')
    self.hasRedis = true
    self.afterRedisInit()
  })
}

HDWallet.prototype.afterRedisInit = function () {
  var self = this
  if (self.needToDiscover) {
    this.discover(function (err) {
      if (err) return self.emit('error', err)
      self.emit('connect')
    })
  } else {
    this.emit('connect')
  }
}

HDWallet.prototype.getKeyPrefix = function () {
  var network = (this.network === bitcoin.networks.bitcoin) ? 'mainnet' : 'testnet'
  return doubleSha256(this.getPrivateSeed()) + '/' + network
}

HDWallet.prototype.getSavedKey = function (key, callback) {
  var savedKey = this.getKeyPrefix() + '/' + key
  if (this.hasRedis) {
    return this.redisClient.get(savedKey, function (err, value) {
      if (err) return callback(err)
      return callback(null, value)
    })
  } else if (this.fs) {
    return callback(null, this.fs.get(savedKey))
  } else {
    return callback('Key ' + key + ' not found.')
  }
}

HDWallet.prototype.getNextAccount = function (callback) {
  var coluSdkNextAccount = this.getKeyPrefix() + '/coluSdkNextAccount'
  if (this.hasRedis) {
    return this.redisClient.get(coluSdkNextAccount, function (err, nextAccount) {
      if (err) return callback(err)
      return callback(null, nextAccount)
    })
  } else if (this.fs) {
    var result = this.fs.get(coluSdkNextAccount) || 0
    return callback(null, result)
  } else {
    return callback(null, this.nextAccount)
  }
}

HDWallet.prototype.setNextAccount = function (nextAccount) {
  var coluSdkNextAccount = this.getKeyPrefix() + '/coluSdkNextAccount'
  this.nextAccount = nextAccount
  this.setDB(coluSdkNextAccount, this.nextAccount)
}

HDWallet.prototype.registerAddress = function (address, accountIndex, addressIndex, change) {
  // console.log('registering '+address)
  change = (change) ? 1 : 0
  var addressKey = this.getKeyPrefix() + '/' + address
  var addressValue = 'm/44\'/0\'/' + accountIndex + '\'/' + change + '/' + addressIndex
  this.setDB(addressKey, addressValue)
}

HDWallet.prototype.setDB = function (key, value) {
  if (this.hasRedis) {
    this.redisClient.set(key, value)
  } else {
    if (this.fs) {
      this.fs.set(key, value)
    }
  }
}

HDWallet.prototype.getAddressPrivateKey = function (address, callback) {
  var self = this

  this.getAddressPath(address, function (err, addressPath) {
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

  this.getNextAccount(function (err, nextAccount) {
    if (err) return callback(err)
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
      self.discoverAddress(accountIndex, currentAddresses, ASKING_INTERVAL, function (err, res) {
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

HDWallet.prototype.discoverAddress = function (accountIndex, addressIndex, interval, callback) {
  var addresses = []
  if (typeof interval === 'function') {
    callback = interval
    interval = 1
  }
  for (var i = 0; i < interval; i++) {
    var hdnode = deriveAddress(this.master, accountIndex, addressIndex++)
    var address = hdnode.getAddress().toString()
    this.registerAddress(address, accountIndex, addressIndex)
    addresses.push(address)
    // console.log('discovering address: ' + address)
  }
  this.isAddressActive(addresses, callback)
}

HDWallet.prototype.registerAccount = function (account) {
  for (var i = 0; i < MAX_EMPTY_ADDRESSES; i++) {
    var hdnode = deriveAddress(this.master, account, i)
    var address = hdnode.getAddress().toString()
    this.registerAddress(address, account, i)
  }
}

HDWallet.prototype.getPrivateSeed = function () {
  return this.privateSeed.toString('hex')
}

HDWallet.prototype.getPrivateKey = function (account, addressIndex) {
  if (typeof account === 'undefined') {
    account = this.nextAccount++
    this.setNextAccount(this.nextAccount)
    this.registerAccount(account)
  }
  addressIndex = addressIndex || 0
  var hdnode = deriveAddress(this.master, account, addressIndex)
  var privateKey = hdnode.privKey
  return privateKey
}

HDWallet.prototype.getPublicKey = function (account, addressIndex) {
  var privateKey = this.getPrivateKey(account, addressIndex)
  var publicKey = privateKey.pub
  this.hdwallet[publicKey.toHex()] = {
    accountIndex: account || this.nextAccount - 1,
    addressIndex: addressIndex || 0
  }
  return publicKey
}

HDWallet.prototype.isAddressActive = function (addresses, callback) {
  if (typeof addresses === 'string') addresses = [addresses]
  request.post(this.coluHost + '/is_addresses_active',
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
