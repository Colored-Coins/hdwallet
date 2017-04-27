/* eslint-env mocha */
var HDWallet = require('..')
var chai = require('chai')
chai.use(require('chai-string'))
var expect = chai.expect
var assert = chai.assert
var bitcoin = require('bitcoinjs-lib')
var bip39 = require('bip39')

var privateSeed = 'ff92aaece15f7b179796f0b849ca69a869f1f043a45b1e4ba821f20db25a52c8'
var mnemonic = 'state convince method grab route rain phone model february dry layer build'
var halfedPrivateSeed = '69f1f043a45b1e4ba821f20db25a52c8'
var privateSeedWIF = 'cW9W4z8UHiypm2nmvsZmwMEcpdW95GNbbRXwJJNrwBKFMzBJbzR1'
var address = 'my1TCiFypidi7177tS3h5Ja2yUPXbVeZJ8'
var addressPriv = 'cTh7jTj6L8zJVkZPGwhKupYodyFPXKCPBMxfhePqEkctKVJ7Myqj'
var halfedAddress = 'mkUXZ2evKunxfG7pSGo841ZoNHqoar8r7c'
var halfedAddressPriv = 'cNpnGQKhEcSQ5RYtvovEgRaixFfYrP68JBPi42N9wVTredHA5bVe'
var unsignedTxHex = '0100000001d542409c9006cf73af5a09fa6814156b635b57a7c8929c7ad6d514254bb6d108020000001976a9143dccfff7d33c163957d94949789baf660bed5a6c88acffffffff0358020000000000001976a9140964477fbc5bcce8c2ddbd8b4c705ef60c5a91e788ac00000000000000000a6a084343010501000110207a0100000000001976a9143dccfff7d33c163957d94949789baf660bed5a6c88ac00000000'
var expectedSignedTxHex = '0100000001d542409c9006cf73af5a09fa6814156b635b57a7c8929c7ad6d514254bb6d108020000006a47304402207b67c24b1602aef5e9da57685a1bf19ad4267f331ef061cfeace70ba7ab119b302206928a96dc9a86c443190759fddf2e372aed450305954a2db9deb36dc2a6115fd01210240042f2cfb410b4fab76a33dd36376fc752b03ee6f14708da6cd4d306670068bffffffff0358020000000000001976a9140964477fbc5bcce8c2ddbd8b4c705ef60c5a91e788ac00000000000000000a6a084343010501000110207a0100000000001976a9143dccfff7d33c163957d94949789baf660bed5a6c88ac00000000'
var privateKey = bitcoin.ECKey.fromWIF('cQ176k8LDck5aNJTQcXd7G4rCqGM3jhJyZ7MNawyzAfaWuVpP5Xb')

describe('Test hdwallet', function () {
  it('Should generate bip39 mnemonic', function (done) {
    var mnemonic = HDWallet.generateMnemonic()
    assert.equal(bip39.validateMnemonic(mnemonic), true, 'should be valid mnemonic.')
    done()
  })

  it('Should validate a valid mnemonic', function (done) {
    assert.equal(HDWallet.validateMnemonic(mnemonic), true, 'should validate a valid mnemonic.')
    done()
  })

  it('Should generate a private seed and mnemonic in constructor', function (done) {
    var hdwallet = new HDWallet({network: 'testnet'})
    var privateSeed = hdwallet.getPrivateSeed()
    var mnemonic = hdwallet.getMnemonic()
    assert.equal(typeof privateSeed, 'string', 'Should be a string.')
    assert.equal(privateSeed.length, 128, 'Should be 64 bytes long (hex string of 128 chars).')
    assert.equal(typeof mnemonic, 'string', 'Should be a string.')
    assert.equal(mnemonic.split(' ').length, 12, 'Should be a 12 word sentence.')
    assert.equal(bip39.validateMnemonic(mnemonic), true, 'should be valid mnemonic.')
    done()
  })

  it('Should return initial array of addresses', function (done) {
    this.timeout(5000)
    var hdwallet = new HDWallet({network: 'testnet'})
    hdwallet.on('connect', function () {
      hdwallet.getAddresses(function (err, addresses) {
        assert.ifError(err)
        expect(addresses).to.be.a('array')
        expect(addresses).to.have.length.above(0)
        done()
      })
    })
    hdwallet.init()
  })

  it('Should load the same privateSeed.', function (done) {
    var hdwallet = new HDWallet({network: 'testnet', privateSeed: privateSeed})
    var hdSeed = hdwallet.getPrivateSeed()
    assert.equal(hdSeed, privateSeed, 'Seeds should be the same.')
    done()
  })

  it('Should load the same mnemonic.', function (done) {
    var hdwallet = new HDWallet({network: 'testnet', mnemonic: mnemonic})
    var hdSeed = hdwallet.getMnemonic()
    assert.equal(hdSeed, mnemonic, 'Mnemonic should be the same.')
    done()
  })

  it('Should load the same halfedPrivateSeed.', function (done) {
    var hdwallet = new HDWallet({network: 'testnet', privateSeed: halfedPrivateSeed})
    var hdSeed = hdwallet.getPrivateSeed()
    assert.equal(hdSeed, halfedPrivateSeed, 'Seeds should be the same.')
    done()
  })

  it('Should load the same privateSeed from private key.', function (done) {
    var hdwallet = new HDWallet({network: 'testnet', privateSeedWIF: privateSeedWIF})
    var hdSeed = hdwallet.getPrivateSeed()
    assert.equal(hdSeed, privateSeed, 'Seeds should be the same.')
    done()
  })

  it('Should init.', function (done) {
    this.timeout(30000)
    var hdwallet = new HDWallet({network: 'testnet', privateSeed: privateSeed})
    hdwallet.on('connect', function () {
      done()
    })
    hdwallet.init()
  })

  it('Should init (halfed).', function (done) {
    this.timeout(30000)
    var hdwallet = new HDWallet({network: 'testnet', privateSeed: halfedPrivateSeed})
    hdwallet.on('connect', function () {
      done()
    })
    hdwallet.init()
  })

  it('Should save the private key of an address.', function (done) {
    this.timeout(60000)
    var hdwallet = new HDWallet({network: 'testnet', privateSeed: privateSeed})
    hdwallet.on('connect', function () {
      hdwallet.getAddressPrivateKey(address, function (err, priv) {
        assert.ifError(err)
        assert(priv)
        assert.equal(priv.toWIF(bitcoin.networks.testnet), addressPriv)
        done()
      })
    })
    hdwallet.init()
  })

  it('Should save the private key of an address (halfed).', function (done) {
    this.timeout(60000)
    var hdwallet = new HDWallet({network: 'testnet', privateSeed: halfedPrivateSeed})
    hdwallet.on('connect', function () {
      hdwallet.getAddressPrivateKey(halfedAddress, function (err, priv) {
        assert.ifError(err)
        assert(priv)
        assert.equal(priv.toWIF(bitcoin.networks.testnet), halfedAddressPriv)
        done()
      })
    })
    hdwallet.init()
  })

  it('Should encrypt/decrypt Private Key', function (done) {
    this.timeout(0)
    var encryptedPrivateKey = HDWallet.encryptPrivateKey(privateSeedWIF, '123')
    assert.equal(HDWallet.decryptPrivateKey(encryptedPrivateKey, '123', 'testnet'), privateSeedWIF, 'Should decrypt correctly')
    done()
  })

  it('Should create a new mainnet Private Key', function (done) {
    this.timeout(120000)
    var key = HDWallet.createNewKey()
    var hdwallet = new HDWallet({privateSeedWIF: key.privateKey})
    hdwallet.on('connect', function () {
      hdwallet.getAddresses(function (err, addresses) {
        assert.ifError(err)
        // console.log('addresses:', addresses)
        expect(addresses).to.be.a('array')
        expect(addresses).to.have.length.above(0)
        done()
      })
    })
    hdwallet.init()
  })

  it('Should create a new testnet Private Key', function (done) {
    this.timeout(120000)
    var key = HDWallet.createNewKey('testnet')
    var hdwallet = new HDWallet({network: 'testnet', privateSeedWIF: key.privateKey})
    hdwallet.on('connect', function () {
      hdwallet.getAddresses(function (err, addresses) {
        assert.ifError(err)
        // console.log('addresses:', addresses)
        expect(addresses).to.be.a('array')
        expect(addresses).to.have.length.above(0)
        done()
      })
    })
    hdwallet.init()
  })

  it('Should create a new encrypted Private Key', function (done) {
    this.timeout(120000)
    var key = HDWallet.createNewKey(null, '123')
    assert(key.encryptedPrivateKey, 'Should generate and encrypted key')
    done()
  })

  it('Should create a get zero account (mainnet)', function (done) {
    this.timeout(120000)
    var key = HDWallet.createNewKey()
    var hdwallet = new HDWallet({privateSeedWIF: key.privateKey})
    hdwallet.on('connect', function () {
      var extendedKey = hdwallet.getAccount(0)
      expect(extendedKey).to.startsWith('xpub')
      assert.equal(extendedKey, key.extendedPublicKey, 'Should return the same extended public key')
      done()
    })
    hdwallet.init()
  })

  it('Should create a get zero account (testnet)', function (done) {
    this.timeout(120000)
    var key = HDWallet.createNewKey('testnet')
    var hdwallet = new HDWallet({network: 'testnet', privateSeedWIF: key.privateKey})
    hdwallet.on('connect', function () {
      var extendedKey = hdwallet.getAccount(0)
      expect(extendedKey).to.startsWith('tpub')
      assert.equal(extendedKey, key.extendedPublicKey, 'Should return the same extended public key')
      done()
    })
    hdwallet.init()
  })

  it('Should get the addresses of the wallet', function (done) {
    this.timeout(60000)
    var hdwallet = new HDWallet({network: 'testnet', privateSeed: privateSeed})
    hdwallet.on('connect', function () {
      hdwallet.getAddresses(function (err, addresses) {
        assert.ifError(err)
        // console.log('addresses:', addresses)
        expect(addresses).to.be.a('array')
        expect(addresses).to.have.length.above(0)
        assert(addresses.indexOf(address) !== -1)
        done()
      })
    })
    hdwallet.init()
  })

  it('Should sign a transaction', function (done) {
    var signtx = HDWallet.sign(unsignedTxHex, privateKey)
    assert.equal(signtx, expectedSignedTxHex)
    done()
  })

  it('Should find transaction addresses to sign', function (done) {
    var addresses = HDWallet.getInputAddresses(unsignedTxHex, bitcoin.networks.testnet)
    assert.ok(Array.isArray(addresses))
    assert.equal(addresses.length, 1, 'Addresses array should contain only one address.')
    assert.equal(addresses[0], 'mm9j6Pxp2LqAqVHqj7DBit724A6P8sk5yA', 'Addresses array should contain the expected address.')
    done()
  })
})
