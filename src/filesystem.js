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
  var self = this
  if (self.conf && key && key in self.conf) {
    return self.conf[key]
  }
  return null
}

FileSystem.prototype.set = function (key, value, callback) {
  var self = this
  if (callback) {
    if (!self.conf) return callback('No conf file loaded.')
    if (!key) return callback('No key.')
    value = value || null
    self.conf[key] = value
    return safePathWrite(self.configFile, self.conf, callback)
  } else {
    if (!self.conf) return 'No conf file loaded.'
    if (!key) return 'No key.'
    value = value || null
    self.conf[key] = value
    return safePathWrite(self.configFile, self.conf)
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
