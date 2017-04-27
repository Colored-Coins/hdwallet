// var assert = require('assert')
var async = require('async')
var util = require('util')
var events = require('events')
var bitcoin = require('bitcoinjs-lib')
var BlockExplorerRpc = require('blockexplorer-rpc')
var crypto = require('crypto')
var CoinKey = require('coinkey')
var Bip38 = require('bip38')
var cs = require('coinstring')
var hash = require('crypto-hashing')
var BigInteger = require('bigi')
var bip39 = require('bip39')
var _ = require('lodash')

var DataStorage = require('data-storage')

var MAX_EMPTY_ACCOUNTS = 3
var MAX_EMPTY_ADDRESSES = 3

var mainnetBlockExplorerHost = 'https://explorer.coloredcoins.org'
var testnetBlockExplorerHost = 'https://testnet.explorer.coloredcoins.org'

var HDWallet = function (settings) {
  var self = this

  settings = settings || {}
  if (settings.network === 'testnet') {
    settings.blockExplorerHost = settings.blockExplorerHost || testnetBlockExplorerHost
    self.network = bitcoin.networks.testnet
  } else {
    settings.blockExplorerHost = settings.blockExplorerHost || mainnetBlockExplorerHost
    self.network = bitcoin.networks.bitcoin
  }
  self.blockexplorer = new BlockExplorerRpc(settings.blockExplorerHost)
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
  self.mnemonic = settings.mnemonic || null
  if (settings.privateKey) {
    console.warn('Deprecated: Please use privateSeedWIF and not privateKey.')
    settings.privateSeedWIF = settings.privateKey
  }
  if (settings.privateSeedWIF) {
    var privateKeySeedBigInt = bitcoin.ECKey.fromWIF(settings.privateSeedWIF, self.network).d
    self.privateSeed = privateKeySeedBigInt.toHex(32)
  }
  if (!self.privateSeed && !self.mnemonic) {
    self.mnemonic = bip39.generateMnemonic()
    self.privateSeed = bip39.mnemonicToSeed(self.mnemonic)
    self.needToScan = false
  } else {
    if (self.mnemonic) {
      if (!bip39.validateMnemonic(self.mnemonic)) {
        throw new Error('Bad mnemonic.')
      }
      if (self.privateSeed && self.privateSeed !== bip39.mnemonicToSeedHex(self.mnemonic)) {
        throw new Error('mnemonic and privateSeed mismatch.')
      }
      self.privateSeed = bip39.mnemonicToSeed(self.mnemonic)
      self.needToScan = true
    } else {
      if (!isValidSeed(self.privateSeed)) {
        throw new Error('privateSeed should be a 128-512 bits hex string (32-128 chars), if you are using WIF, use privateSeedWIF instead.')
      }
      self.privateSeed = new Buffer(self.privateSeed, 'hex')
      self.needToScan = true
    }
  }
  self.max_empty_accounts = settings.max_empty_accounts || MAX_EMPTY_ACCOUNTS
  self.max_empty_addresses = settings.max_empty_addresses || MAX_EMPTY_ADDRESSES
  self.known_fringe = settings.known_fringe || []
  self.master = bitcoin.HDNode.fromSeedHex(self.privateSeed, self.network)
  self.nextAccount = 0
  self.addresses = []
  self.preAddressesNodes = {}
  self.discovering = false
  if (settings.ds) {
    self.ds = settings.ds
  }
  self.offline = !!settings.offline
}

var isValidSeed = function (seed) {
  return (typeof(seed) === 'string' && seed.length >= 32 && seed.length <= 128 && seed.length % 2 === 0 && !isNaN(parseInt(seed, 16)))
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
  var node = master
  // BIP0044:
  // purpose'
  node = node.deriveHardened(44)
  // coin_type'
  node = node.deriveHardened(network === bitcoin.networks.bitcoin ? 0 : 1)
  // account'
  node = node.deriveHardened(0)
  var extendedKey = node.toBase58(false)
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

HDWallet.validateMnemonic = bip39.validateMnemonic

HDWallet.generateMnemonic = bip39.generateMnemonic

HDWallet.sign = function (unsignedTxHex, privateKey) {
  var tx = bitcoin.Transaction.fromHex(unsignedTxHex)
  var txb = bitcoin.TransactionBuilder.fromTransaction(tx)
  var insLength = tx.ins.length
  for (var i = 0; i < insLength; i++) {
    txb.inputs[i].scriptType = null
    if (Array.isArray(privateKey)) {
      txb.sign(i, privateKey[i])
    } else {
      txb.sign(i, privateKey)
    }
  }
  tx = txb.build()
  return tx.toHex()
}

HDWallet.getInputAddresses = function (txHex, network) {
  network = network || bitcoin.networks.bitcoin
  var addresses = []
  var tx
  try {
    tx = bitcoin.Transaction.fromHex(txHex)
  } catch (err) {
    console.error('HDWallet.getInputAddresses: ', txHex)
    console.error(err)
    return null
  }
  tx.ins.forEach(function (input) {
    if (!input.script) return addresses.push(null)
    if (bitcoin.scripts.isPubKeyHashOutput(input.script)) return addresses.push(new bitcoin.Address(input.script.chunks[2], network.pubKeyHash).toString())
    if (bitcoin.scripts.isScriptHashOutput(input.script)) return addresses.push(new bitcoin.Address(input.script.chunks[1], network.scriptHash).toString())
    return addresses.push(null)
  })
  return addresses
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
  self.discover(function (err) {
    if (err) {
      self.emit('error', err)
      if (cb) return cb(err)
      else return false
    }
    self.emit('connect')
    if (cb) cb(null, self)
  })
}

HDWallet.prototype.getAccount = function (index) {
  index = index || 0
  var extendedKey = this.deriveAccount(index).toBase58(false)
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
    keys = keys || []
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
  var coinType = self.network === bitcoin.networks.bitcoin ? 0 : 1
  change = (change) ? 1 : 0
  var addressValue = 'm/44\'/' + coinType + '\'/' + accountIndex + '\'/' + change + '/' + addressIndex
  self.setDB(addressKey, addressValue)
  self.addresses[accountIndex] = self.addresses[accountIndex] || []
  self.addresses[accountIndex][addressIndex] = address
  self.emit('registerAddress', address)
}

HDWallet.prototype.getAddressPrivateKey = function (address, callback) {
  var self = this

  self.getAddressPath(address, function (err, addressPath) {
    if (err) return callback(err)
    if (!addressPath) return callback('Address ' + address + ' privateKey not found.')
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

HDWallet.prototype.rediscover = function(max_empty_accounts, max_empty_addresses, callback) {
  if (typeof max_empty_accounts == 'function') {
    callback = max_empty_accounts
    max_empty_accounts = this.max_empty_accounts
    max_empty_addresses = this.max_empty_addresses
  }
  if (typeof max_empty_addresses == 'function') {
    callback = max_empty_addresses
    max_empty_addresses = this.max_empty_addresses
  }
  this.max_empty_accounts = max_empty_accounts || this.max_empty_accounts
  this.max_empty_addresses = max_empty_addresses || this.max_empty_addresses
  this.discover(callback)
}

HDWallet.prototype.discover = function (callback) {
  callback = callback || function () {}
  var self = this
  if (self.discovering == true) return callback()
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
            fringeAddresses = self.getFringeAddresses(fringe)
            var addresses = Object.keys(fringeAddresses)
            if (self.needToScan && !self.offline) {
              self.isAddressActive(addresses, cb)
            } else {
              cb(null, addresses.map(function (address) {
                return {
                  address: address,
                  active: false
                }
              }))
            }
          },
          function (discoveredAddresses, cb) {
            allScaned = self.calcNextFringe(fringe, fringeAddresses, discoveredAddresses)
            if (allScaned) {
              self.saveFrienge(fringe)
              self.needToScan = true
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

  self.getDB('fringe', function (err, fringe) {
    if (err) return callback(err)
    fringe = fringe || '[]'
    fringe = JSON.parse(fringe)
    var longest_fringe = fringe.length > self.known_fringe.length ? fringe : self.known_fringe
    longest_fringe = longest_fringe.map(function (data, i) {
      var nextUnused = Math.max(fringe[i] || 0, self.known_fringe[i] || 0)
      return {nextUnused: nextUnused, nextUnknown: nextUnused}
    })
    return callback(null, longest_fringe)
  })
}

HDWallet.prototype.saveFrienge = function (fringe) {
  var self = this

  var cachedFringe = fringe.map(function (account) {
    return account.nextUnused
  })
  cachedFringe = JSON.stringify(cachedFringe)
  self.setDB('fringe', cachedFringe)
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
    for (var i = account.nextUnknown; i < account.nextUnused + self.max_empty_addresses; i++) {
      var address = self.getAddress(currentAccount, i)
      fringeAddresses[address] = {
        account: currentAccount,
        address: i
      }
    }
    currentAccount++
  })
  for (var j = 0; j < self.max_empty_accounts - numOfEmptyAccounts; j++) {
    fringe.push({nextUnused: 0, nextUnknown: 0})
    for (var i = 0; i < self.max_empty_addresses; i++) {
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
    if (account.nextUnknown - account.nextUnused < self.max_empty_addresses) allScaned = false
    if (account.nextUnused == 0) {
      numOfEmptyAccounts++
    } else {
      numOfEmptyAccounts = 0
      self.nextAccount = Math.max(i + 1, self.nextAccount)
    }
  })
  return allScaned && numOfEmptyAccounts >= self.max_empty_accounts
}

HDWallet.prototype.getPrivateSeed = function () {
  return this.privateSeed.toString('hex')
}

HDWallet.prototype.getPrivateSeedWIF = function () {
  if (this.privateSeed.length > 256) {
    throw new Error('Seed is bigger than 256 bits, try getPrivateSeed or getMnemonic instead.')
  }
  console.warn('Deprecated: getPrivateSeedWIF is deprecated.')
  var d = BigInteger.fromBuffer(this.privateSeed)
  var priv = new bitcoin.ECKey(d, true)
  return priv.toWIF(this.network)
}

HDWallet.prototype.getMnemonic = function () {
  if (!this.mnemonic) {
    throw new Error('Seed generated without mnemonic, try getPrivateSeed or getPrivateSeedWIF instead.')
  }
  return this.mnemonic
}

HDWallet.prototype.getPrivateKey = function (account, addressIndex) {
  var self = this

  if (typeof account === 'undefined') {
    account = self.nextAccount++
  }
  addressIndex = addressIndex || 0
  var hdnode = self.deriveAddress(account, addressIndex)
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
  async.map(_.chunk(addresses, 100), function (chunk, cb) {
    self.blockexplorer.post('isactive', {addresses: chunk},
      function (err, res) {
        if (err) return cb(err)
        return callback(null, res)
      }
    )
  }, function (err, results) {
    if (err) return callback(err)
    callback(null, _.flatten(results))
  })
}

HDWallet.prototype.deriveAddress = function (accountIndex, addressIndex) {
  var node
  if (this.preAddressesNodes[accountIndex]) {
    node = this.preAddressesNodes[accountIndex]
  } else {
    node = this.deriveAccount(accountIndex)
    // no change
    node = node.derive(0)
    this.preAddressesNodes[accountIndex] = node
  }
  
  // address_index
  node = node.derive(addressIndex)

  return node
}

HDWallet.prototype.deriveAccount = function (accountIndex) {
  var node
  if (this.preAccountNode) {
    node = this.preAccountNode
  } else {
    node = this.master
    // BIP0044:
    // purpose'
    node = node.deriveHardened(44)
    // coin_type'
    node = node.deriveHardened(this.network === bitcoin.networks.bitcoin ? 0 : 1)
    this.preAccountNode = node
  }
  // account'
  node = node.deriveHardened(accountIndex)

  return node
}

HDWallet.prototype.sign = function (unsignedTxHex, callback) {
  var self = this
  var addresses = HDWallet.getInputAddresses(unsignedTxHex, self.network)
  if (!addresses) return callback("can't find addresses to sign")
  async.map(addresses,
    function (address, cb) {
      self.getAddressPrivateKey(address, cb)
    },
    function (err, privateKeys) {
      if (err) return callback(err)
      var signedTxHex = HDWallet.sign(unsignedTxHex, privateKeys)
      callback(null, signedTxHex)
    }
  )
}

var doubleSha256 = function (message) {
  var sha = crypto.createHash('sha256').update(message).digest()
  sha = crypto.createHash('sha256').update(sha).digest('hex')
  return sha
}

module.exports = HDWallet
