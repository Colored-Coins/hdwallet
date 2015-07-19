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
  if (this.conf && key && key in this.conf) {
    return this.conf[key]
  }
  return null
}

FileSystem.prototype.set = function (key, value, callback) {
  if (callback) {
    if (!this.conf) return callback('No conf file loaded.')
    if (!key) return callback('No key.')
    value = value || null
    this.conf[key] = value
    return safePathWrite(this.configFile, this.conf, callback)
  } else {
    if (!this.conf) return 'No conf file loaded.'
    if (!key) return 'No key.'
    value = value || null
    this.conf[key] = value
    return safePathWrite(this.configFile, this.conf)
  }
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
