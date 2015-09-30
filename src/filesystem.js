var path = require('path-extra')
var mkpath = require('mkpath')
var jf = require('jsonfile')

module.exports = FileSystem

function FileSystem (callback) {
  var self = this
  self.appPath = path.datadir('hdwallet')
  self.configFile = path.join(self.appPath, 'properties.conf')

  if (callback) {
    jf.readFile(self.configFile, function (err, conf) {
      if (err) {
        self.conf = {}
        safePathWrite(self.configFile, self.conf, function (err) {
          if (err) return callback(err)
          return callback(null, self)
        })
      }
      self.conf = conf
      return callback(null, self)
    })
  } else {
    self.conf = jf.readFileSync(self.configFile, {throws: false})
    if (!self.conf) {
      self.conf = {}
      safePathWrite(self.configFile, self.conf)
    }
  }
}

FileSystem.prototype.get = function (key) {
  if (this.conf && key && this.conf[key]) {
    return this.conf[key]
  }
  return null
}

FileSystem.prototype.hget = function (key, hash) {
  if (this.conf && key && hash && this.conf[key] && typeof this.conf[key] === 'object') {
    return this.conf[key][hash]
  }
  return null
}

FileSystem.prototype.set = function (key, value, callback) {
  if (!callback) callback = function () { }
  if (!this.conf) return callback('No conf file loaded.')
  if (!key) return callback('No key.')
  value = value || null
  this.conf[key] = value
  return safePathWrite(this.configFile, this.conf, callback)
}

FileSystem.prototype.hset = function (key, hash, value, callback) {
  if (!callback) callback = function () { }
  if (!this.conf) return callback('No conf file loaded.')
  if (!key) return callback('No key.')
  if (!hash) return callback('No hash.')
  value = value || null
  this.conf[key] = this.conf[key] || {}
  if (typeof this.conf[key] !== 'object') return callback('Key ' + key + ' is set but not an object.')
  this.conf[key][hash] = value
  return safePathWrite(this.configFile, this.conf, callback)
}

FileSystem.prototype.hkeys = function (key) {
  if (this.conf && key && this.conf[key] && typeof this.conf[key] === 'object') {
    return Object.keys(this.conf[key])
  }
  return []
}

var safePathWrite = function (file, content, callback) {
  var dirname = path.dirname(file)
  if (callback) {
    mkpath(dirname, function (err) {
      if (err) return callback(err)
      jf.writeFile(file, content, callback)
    })
  } else {
    mkpath.sync(dirname, content)
    jf.writeFileSync(file, content)
  }
}
