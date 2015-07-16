var HDWallet = require(__dirname + '/../src/hdwallet.js')
var assert = require('assert')
var bitcoin = require('bitcoinjs-lib')

describe('Test hdwallet', function () {
	it('Should generate a private seed.', function (done) {
		var hdwallet = new HDWallet({network: 'testnet'})
		var privateSeed = hdwallet.getPrivateSeed()
		assert.equal(typeof(privateSeed), 'string', 'Should be a string.')
		console.log(privateSeed)
		assert.equal(privateSeed.length, 64, 'Should be 32 bytes long (hex string of 64 chars).')
		done()
	})

	it('Should load the same privateSeed.', function (done) {
		var privateSeed = 'ff92aaece15f7b179796f0b849ca69a869f1f043a45b1e4ba821f20db25a52c8'
		var hdwallet = new HDWallet({network: 'testnet', privateSeed: privateSeed})
		var hdSeed = hdwallet.getPrivateSeed()
		assert.equal(hdSeed, privateSeed, 'Seeds should be the same.')
		done()
	})

	// it('Should init.', function (done) {
	// 	this.timeout(30000)
	// 	var privateSeed = 'ff92aaece15f7b179796f0b849ca69a869f1f043a45b1e4ba821f20db25a52c8'
	// 	var hdwallet = new HDWallet({network: 'testnet', privateSeed: privateSeed})
	// 	hdwallet.on('connect', function() {
	// 		done()
	// 	})
	// 	hdwallet.init()	
	// })

	it('Should save the private key of an address', function (done) {
		this.timeout(30000)
		var privateSeed = 'ff92aaece15f7b179796f0b849ca69a869f1f043a45b1e4ba821f20db25a52c8'
		var hdwallet = new HDWallet({network: 'testnet', privateSeed: privateSeed})
		hdwallet.on('connect', function() {
			hdwallet.getAddressPrivateKey('mgNcWJp4hPd7MN6ets2P8HcB5k99aCs8cy', function (err, priv) {
				if (err) return done(err)
				assert(priv.toWIF(bitcoin.networks.testnet), 'cQ176k8LDck5aNJTQcXd7G4rCqGM3jhJyZ7MNawyzAfaWuVpP5Xb')
				done()
			})
		})
		hdwallet.init()
	})

})
