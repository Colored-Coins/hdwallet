module.exports = LocalStorage

function LocalStorage () {}

LocalStorage.prototype.get = function (key) {
  return localStorage.getItem(key)
}

LocalStorage.prototype.set = function (key, value) {
  return localStorage.setItem(key, value)
}
