const path = require('path');
const crypto = require('crypto');
const express = require('express');
const apiRouter = require('./routes/api');

// .env があれば読み込む（Vercel では環境変数を使う）
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env が無くても動かす */ }

const app = express();
const port = Number(process.env.PORT) || 3000;

// 合言葉（ACCESS_PASSWORD）があれば、ページと API の全体に Basic 認証をかける（公開 URL で API キーを勝手に使わせないため）。
// ユーザー名は何でもよく、パスワードだけを確かめる。ブラウザが資格情報なしで取りに来る manifest とアプリのアイコンは除く。
const PUBLIC_PATHS = new Set(['/manifest.webmanifest', '/img/app-192.png', '/img/app-512.png']);
const digest = s => crypto.createHash('sha256').update(String(s)).digest();
app.use((req, res, next) => {
  const password = process.env.ACCESS_PASSWORD;
  if (!password || PUBLIC_PATHS.has(req.path)) return next();
  const [scheme, encoded] = String(req.headers.authorization || '').split(' ');
  const given = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString('utf8').replace(/^[^:]*:/, '') : '';
  if (crypto.timingSafeEqual(digest(given), digest(password))) return next();
  res.set('WWW-Authenticate', 'Basic realm="esd-app", charset="UTF-8"');
  res.status(401).send('合言葉が必要です');
});

app.use(express.json({ limit: '4.5mb' })); // 平面図の画像（base64）を受け取るため。Vercel が受け取れる上限（4.5MB）に合わせる
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, 'public')));

// 存在しない API は JSON で返す
app.use('/api', (req, res) => res.status(404).json({ error: 'Not Found' }));

if (require.main === module) {
  app.listen(port, () => {
    console.log(`Server is running at http://localhost:${port}`);
  });
}

module.exports = app;
