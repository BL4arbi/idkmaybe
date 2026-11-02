import jwt from 'jsonwebtoken';

const SECRET = process.env.JWT_SECRET;

export function signSessionToken(user) {
  return jwt.sign(
    { sub: user.id, username: user.username, admin: user.is_admin },
    SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, SECRET);
}
