const crypto = require('crypto');

module.exports = (length = 4) => crypto.randomBytes(length).toString('hex');
