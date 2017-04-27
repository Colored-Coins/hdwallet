# hdwallet
[![Build Status](https://travis-ci.org/Colored-Coins/hdwallet.svg?branch=master)](https://travis-ci.org/Colored-Coins/hdwallet) [![Coverage Status](https://coveralls.io/repos/github/Colored-Coins/hdwallet/badge.svg?branch=master)](https://coveralls.io/github/Colored-Coins/hdwallet?branch=master) [![npm version](https://badge.fury.io/js/hdwallet.svg)](http://badge.fury.io/js/hdwallet)

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
  mnemonic: 'optional',
  privateSeed: 'optional' // deprecated
})
```

### API's

```js
HDWallet.encryptPrivateKey(privateWif, password, progressCallback)	// BIP38
HDWallet.decryptPrivateKey(encryptedPrivKey, password, network, progressCallback)  // BIP38
HDWallet.createNewKey(network, password, progressCallback)
HDWallet.generateMnemonic()  // BIP39
HDWallet.validateMnemonic()  // BIP39
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
HDWallet.prototype.getMnemonic()
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

### License

[Apache-2.0](http://www.apache.org/licenses/LICENSE-2.0)
