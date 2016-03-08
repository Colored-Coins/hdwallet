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
var BigInteger = require('bigi')

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
  if (settings.privateSeed && (settings.privateKey || settings.privateSeedWIF)) {
    throw new Error('Can\'t have both privateSeed and privateKey/privateSeedWIF.')
  }
  if (settings.veryOldPrivateKey) {
    settings.oldPrivateSeedWIF = new Buffer(settings.veryOldPrivateKey, 'hex')
  }
  if (settings.oldPrivateSeed || settings.oldPrivateSeedWIF) {
    var oldSeed = settings.oldPrivateSeed || settings.oldPrivateSeedWIF
    oldSeed = crypto.createHash('sha256').update(oldSeed).digest()
    oldSeed = crypto.createHash('sha256').update(oldSeed).digest('hex')
    settings.privateSeed = oldSeed
    console.warn('Deprecated: veryOldPrivateKey, oldPrivateSeed and oldPrivateSeedWIF are deprecated, Please get your new privateSeed (for the same wallet) by getPrivateSeed or getPrivateSeedWIF.')
  }
  if (settings.privateKey && settings.privateSeedWIF && settings.privateKey !== settings.privateSeedWIF) {
    throw new Error('Can\'t privateKey and privateSeedWIF should be the same (can use only one).')
  }
  self.privateSeed = settings.privateSeed || null
  if (settings.privateKey) {
    console.warn('Deprecated: Please use privateSeedWIF and not privateKey.')
    settings.privateSeedWIF = settings.privateKey
  }
  if (settings.privateSeedWIF) {
    var privateKeySeedBigInt = bitcoin.ECKey.fromWIF(settings.privateSeedWIF, self.network).d
    self.privateSeed = privateKeySeedBigInt.toHex(32)
  }
  if (!self.privateSeed) {
    self.privateSeed = crypto.randomBytes(32)
    self.needToDiscover = false
  } else {
    if (!isValidSeed(self.privateSeed)) {
      throw new Error('privateSeed should be a 256 bits hex (64 chars), if you are using WIF, use privateSeedWIF instead.')
    }
    self.privateSeed = new Buffer(self.privateSeed, 'hex')
    self.needToDiscover = true
  }
  self.master = bitcoin.HDNode.fromSeedHex(self.privateSeed, self.network)
  self.nextAccount = 0
  self.addresses = []
  self.discovering = false
  if (settings.ds) {
    self.ds = settings.ds
  }
}

var isValidSeed = function (seed) {
  return (typeof(seed) === 'string' && seed.length === 64 && !isNaN(parseInt(seed, 16)))
}

util.inherits(HDWallet, events.EventEmitter)

HDWallet.encryptPrivateKey = function (privateWif, password, progressCallback) {
  var key = CoinKey.fromWif(privateWif)
  var bip38 = new Bip38()
  return bip38.encrypt(key.privateWif, password, key.publicAddress, progressCallback)
}

HDWallet.decryptPrivateKey = function (encryptedPrivKey, password, network, progressCallback) {
  var bip38 = new Bip38()

  if (typeof network === 'function') {
    progressCallback = network
    network = null
  }
  if (network) {
    if (typeof network === 'string') {
      if (network === 'testnet') {
        bip38.versions = {
          private: 0xef
        }
      }
    } else {
      bip38.versions = {
        private: network.wif || 0x80
      }
    }
  }

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
  var privateSeed = key.d.toHex(32)
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

HDWallet.prototype.getAccount = function (index) {
  index = index || 0
  var extendedKey = deriveAccount(this.master, index).toBase58(false)
  return extendedKey
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

HDWallet.prototype.registerAddress = function (address, accountIndex, addressIndex, change) {
  var self = this

  var addressKey = 'address/' + address
  change = (change) ? 1 : 0
  var addressValue = 'm/44\'/0\'/' + accountIndex + '\'/' + change + '/' + addressIndex
  // console.log('registering', address, addressValue)
  self.setDB(addressKey, addressValue)
  self.addresses[accountIndex] = self.addresses[accountIndex] || []
  self.addresses[accountIndex][addressIndex] = address
  self.emit('registerAddress', address)
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
    privateKey.getFormattedValue = function() {
      return this.toWIF(self.network)
    }
    callback(null, privateKey)
  })
}

HDWallet.prototype.getAddressPath = function (address, callback) {
  var addressKey = 'address/' + address
  this.getDB(addressKey, callback)
}

HDWallet.prototype.discover = function (callback) {
  callback = callback || function () {}
  var self = this
  if (self.discovering == false) return callback()
  self.discovering = true
  return self.calcCurrentFringe(function (err, fringe) {
    if (err) return callback(err)
    // register tree addresses
    fringe.forEach(function (account, i) {
      for (var j = 0; j < account.nextUnused; j++) {
        self.getAddress(i, j) // will register the address
      }
    })
    var allScaned = false
    // scan fringe
    async.whilst(function () { return !allScaned },
      function (cb) {
        var fringeAddresses
        async.waterfall([
          function (cb) {
            // console.log('fringe:', JSON.stringify(fringe))
            fringeAddresses = self.getFringeAddresses(fringe)
            // console.log('fringeAddresses:', JSON.stringify(fringeAddresses))
            var addresses = Object.keys(fringeAddresses)
            self.isAddressActive(addresses, cb)
          },
          function (discoveredAddresses, cb) {
            allScaned = self.calcNextFringe(fringe, fringeAddresses, discoveredAddresses)
            if (allScaned) {
              self.saveFrienge(fringe)
              self.needToDiscover = false
            }
            cb()
          }
        ], cb)
      },
      function (err) {
        self.discovering = false
        callback(err)
      }
    )
  })
}

HDWallet.prototype.calcCurrentFringe = function (callback) {
  var self = this

  self.getDB('coluSdkfringe', function (err, fringe) {
    if (err) return callback(err)
    fringe = fringe || '[]'
    fringe = JSON.parse(fringe)
    fringe = fringe.map(function (nextUnused) {
      return {nextUnused: nextUnused, nextUnknown: nextUnused}
    })
    return callback(null, fringe)
  })
}

HDWallet.prototype.saveFrienge = function (fringe) {
  var self = this

  var cachedFringe = fringe.map(function (account) {
    return account.nextUnused
  })
  cachedFringe = JSON.stringify(cachedFringe)
  self.setDB('coluSdkfringe', cachedFringe)
}

HDWallet.prototype.getFringeAddresses = function (fringe) {
  var self = this

  var numOfEmptyAccounts = 0
  var currentAccount = 0
  var fringeAddresses = {}
  fringe.forEach(function (account) {
    if (account.nextUnused) {
      numOfEmptyAccounts = 0
    } else {
      numOfEmptyAccounts++
    }
    for (var i = account.nextUnknown; i < account.nextUnused + MAX_EMPTY_ADDRESSES; i++) {
      var address = self.getAddress(currentAccount, i)
      fringeAddresses[address] = {
        account: currentAccount,
        address: i
      }
    }
    currentAccount++
  })
  for (var j = 0; j < MAX_EMPTY_ACCOUNTS - numOfEmptyAccounts; j++) {
    fringe.push({nextUnused: 0, nextUnknown: 0})
    for (var i = 0; i < MAX_EMPTY_ADDRESSES; i++) {
      var address = self.getAddress(currentAccount, i)
      fringeAddresses[address] = {
        account: currentAccount,
        address: i
      }
    }
    currentAccount++
  }
  return fringeAddresses
}

HDWallet.prototype.calcNextFringe = function (fringe, fringeAddresses, discoveredAddresses) {
  var self = this
  discoveredAddresses.forEach(function (discoveredAddress) {
    var fringeAddress = fringeAddresses[discoveredAddress.address]
    if (!fringeAddress) return
    var account = fringe[fringeAddress.account]
    if (!account) return
    if (discoveredAddress.active) {
      account.nextUnused = Math.max(fringeAddress.address + 1, account.nextUnused)
    }
    account.nextUnknown = Math.max(fringeAddress.address + 1, account.nextUnknown)
  })
  var allScaned = true
  var numOfEmptyAccounts = 0
  fringe.forEach(function (account, i) {
    if (account.nextUnknown - account.nextUnused < MAX_EMPTY_ADDRESSES) allScaned = false
    if (account.nextUnused == 0) {
      numOfEmptyAccounts++
    } else {
      numOfEmptyAccounts = 0
      self.nextAccount = Math.max(i + 1, self.nextAccount)
    }
  })
  return allScaned && numOfEmptyAccounts >= MAX_EMPTY_ACCOUNTS
}

HDWallet.prototype.getPrivateSeed = function () {
  return this.privateSeed.toString('hex')
}

HDWallet.prototype.getPrivateSeedWIF = function () {
  var d = BigInteger.fromBuffer(this.privateSeed)
  var priv = new bitcoin.ECKey(d, true)
  return priv.toWIF(this.network)
}

HDWallet.prototype.getPrivateKey = function (account, addressIndex) {
  var self = this

  if (typeof account === 'undefined') {
    account = self.nextAccount++
  }
  addressIndex = addressIndex || 0
  var hdnode = deriveAddress(self.master, account, addressIndex)
  var privateKey = hdnode.privKey
  privateKey.getFormattedValue = function() {
    return this.toWIF(self.network)
  }
  var address = privateKey.pub.getAddress(self.network).toString()
  self.registerAddress(address, account, addressIndex)
  return privateKey
}

HDWallet.prototype.getPublicKey = function (account, addressIndex) {
  var self = this

  var privateKey = self.getPrivateKey(account, addressIndex)
  var publicKey = privateKey.pub
  publicKey.getFormattedValue = publicKey.toHex

  return publicKey
}

HDWallet.prototype.getAddress = function (account, addressIndex) {
  var self = this
  var address = typeof account !== 'undefined' && typeof addressIndex !== 'undefined' && self.addresses[account] && self.addresses[account][addressIndex]
  if (!address) {
    address = self.getPublicKey(account, addressIndex).getAddress(self.network).toString()
    if (typeof account === 'undefined') {
      account = self.nextAccount
    }
    addressIndex = addressIndex || 0
    self.addresses[account] = self.addresses[account] || []
    self.addresses[account][addressIndex] = address
  }
  return address
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
  sha = crypto.createHash('sha256').update(sha).digest('hex')
  return sha
}

module.exports = HDWallet
