const jwt = require('jsonwebtoken');
const JWT_SECRET = process.env.TRENDIFY_JWT_SECRET || 'secret';

const {
  floor
} = Math;

const {
  now
} = Date;

module.exports = (user_id, session_id, exp = floor(now() / 1000) - 30) => {
  return jwt.sign({
    user_id,
    session_id
  }, JWT_SECRET);
}
