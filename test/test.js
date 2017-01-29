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
var address = 'mgNcWJp4hPd7MN6ets2P8HcB5k99aCs8cy'
var addressPriv = 'cTTRtU94sjuGE63U3PzzmMx3nsvzpCb21YXYegFUjftQHAymwofB'
var halfedAddress = 'n13YCGhDVFJxyzz1PHjVqsa5LxEr5jV7bV'
var halfedAddressPriv = 'cQVjENPfApC7zb8ZqKQqb6WcvjfvGhSbV8GEBwJBt2Pupb1pCYos'

describe('Test hdwallet', function () {
  it('Should generate a private seed and mnemonic.', function (done) {
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

})
