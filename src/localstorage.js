module.exports = LocalStorage

function LocalStorage () {}

LocalStorage.prototype.get = function (key) {
  var value = localStorage.getItem(key)
  try {
    value = JSON.parse(value)
  } catch (e) {
    // not an object...
  }
  return value
}

LocalStorage.prototype.set = function (key, value) {
  if (typeof value === 'object') {
    value = JSON.stringify(value)
  }
  return localStorage.setItem(key, value)
}

LocalStorage.prototype.hget = function (key, hash) {
  if (key && hash) {
    var hvalue = this.get(key)
    if (hvalue && typeof hvalue === 'object') {
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
    // this.set(key, {})
    hvalue = {}
  }
  if (typeof hvalue !== 'object') return callback('Key ' + key + ' is set but not an object.')
  hvalue[hash] = value
  this.set(key, hvalue)
  callback()
}

LocalStorage.prototype.hkeys = function (key) {
  if (key) {
    var hvalue = this.get(key)
    if (hvalue && typeof hvalue === 'object') {
      return Object.keys(hvalue)
    } else {
      return null
    }
  }
  return []
}
