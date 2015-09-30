module.exports = LocalStorage

function LocalStorage () {}

LocalStorage.prototype.get = function (key) {
  return localStorage.getItem(key)
}

LocalStorage.prototype.set = function (key, value) {
  return localStorage.setItem(key, value)
}

LocalStorage.prototype.hget = function (key, hash) {
  if (key && hash) {
  	var hvalue = this.get(key)
  	if (typeof hvalue === 'object') {
  		return hvalue[hash]
  	}
  } 
  return null
}

LocalStorage.prototype.hset = function (key, hash, value, callback) {
  if (!callback) callback = function () { }
  if (!key) return callback('No key.')
  if (!hash) return callback('No hash.')
  value = value || null
  var hvalue = this.get(key)
  if (!hvalue) {
  	this.set(key, {})
  	hvalue = {}
  }
  if (typeof hvalue !== 'object') return callback('Key '+key+' is set but not an object.')
  hvalue[hash] = value
  set(key, hvalue)
  callback()
}

LocalStorage.prototype.hkeys = function (key) {
  if (key) {
  	var hvalue = this.get(key)
  	if (typeof hvalue === 'object') {
  		return Object.keys(hvalue)
  	}
  	else {
  		return null
  	}
  }
  return []
}