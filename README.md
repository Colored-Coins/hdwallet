# hdwallet
[![Build Status](https://travis-ci.org/Colu-platform/hdwallet.svg?branch=master)](https://travis-ci.org/Colu-platform/hdwallet) [![Coverage Status](https://coveralls.io/repos/github/Colu-platform/hdwallet/badge.svg?branch=master)](https://coveralls.io/github/Colu-platform/hdwallet?branch=master) [![npm version](https://badge.fury.io/js/hdwallet.svg)](http://badge.fury.io/js/hdwallet)

[![js-standard-style](https://cdn.rawgit.com/feross/standard/master/badge.svg)](https://github.com/feross/standard)

### Installation

```sh
$ npm i hdwallet
```

### Constructor

```js
var HDWallet = require('hdwallet')

var hd = new HDWallet({
  settings = settings || {}
  redisPort: 'optional',
  redisHost: 'optional',
  network: 'optional',
  privateSeed: 'optional'
})
```

### API's

```js
HDWallet.encryptPrivateKey(privateWif, password, progressCallback)	\\ BIP38
HDWallet.decryptPrivateKey(encryptedPrivKey, password, network, progressCallback)  \\ BIP38
HDWallet.createNewKey(network, password, progressCallback)
HDWallet.getInputAddresses(txHex, network)
HDWallet.sign(unsignedTxHex, privateKey)
HDWallet.prototype.init(cb)
HDWallet.prototype.afterRedisInit(cb)
HDWallet.prototype.getKeyPrefix()
HDWallet.prototype.getSavedKey(key, cb)
HDWallet.prototype.getNextAccount(cb)
HDWallet.prototype.setNextAccount(nextAccount)
HDWallet.prototype.registerAddress(address, accountIndex, addressIndex, change)
HDWallet.prototype.setDB(key, value)
HDWallet.prototype.getAddressPrivateKey(address, cb)
HDWallet.prototype.getAddressPath(address, cb)
HDWallet.prototype.discover(cb)
HDWallet.prototype.discoverAccount(accountIndex, cb)
HDWallet.prototype.discoverAddress(accountIndex, addressIndex, interval, cb)
HDWallet.prototype.registerAccount(account)
HDWallet.prototype.getPrivateSeed()
HDWallet.prototype.getPrivateKey(account, addressIndex)
HDWallet.prototype.getPublicKey(account, addressIndex)
HDWallet.prototype.isAddressActive(addresses, cb)
HDWallet.prototype.getAddress(account, addressIndex)
HDWallet.prototype.sign(unsignedTxHex, cb)
```

### Testing

```sh
$ mocha
```
