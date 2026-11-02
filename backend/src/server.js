import app from './app.js';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET is not set — refusing to start (see .env.example).');
  process.exit(1);
}

const port = process.env.PORT || 4100;
app.listen(port, () => console.log(`Tacquet Hub API listening on http://localhost:${port}`));
