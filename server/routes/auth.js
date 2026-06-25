import { Router } from 'express';
import bcrypt from 'bcryptjs';
import db from '../db.js';
import { generateToken } from '../middleware/auth.js';
import { httpError, jsonError } from '../utils/appError.js';

const router = Router();

router.post('/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return jsonError(res, httpError(400, '用户名和密码不能为空'), '注册失败');
  }
  if (password.length < 4) {
    return jsonError(res, httpError(400, '密码至少4位'), '注册失败');
  }
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existing) {
    return jsonError(res, httpError(409, '用户名已存在'), '注册失败');
  }
  const hash = bcrypt.hashSync(password, 10);
  const result = db.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)').run(username, hash);
  const token = generateToken(result.lastInsertRowid);
  res.json({ token, user: { id: result.lastInsertRowid, username } });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return jsonError(res, httpError(400, '用户名和密码不能为空'), '登录失败');
  }
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return jsonError(res, httpError(401, '用户名或密码错误'), '登录失败');
  }
  const token = generateToken(user.id);
  res.json({ token, user: { id: user.id, username: user.username } });
});

export default router;
