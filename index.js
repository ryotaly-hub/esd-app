const path = require('path');
const express = require('express');
const apiRouter = require('./routes/api');

// .env があれば読み込む（Vercel では環境変数を使う）
try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* .env が無くても動かす */ }

const app = express();
const port = Number(process.env.PORT) || 3000;

app.use(express.json({ limit: '6mb' })); // 平面図の画像（base64）を受け取るため
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
