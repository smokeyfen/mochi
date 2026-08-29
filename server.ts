import express from 'express';
import path from 'node:path';

const app = express();
const port = Number(process.env.PORT) || 3000;

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');

    app.use(express.static(distPath));
    app.use((_request, response) => {
      response.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      appType: 'spa',
      server: { middlewareMode: true },
    });

    app.use(vite.middlewares);
  }

  app.listen(port, () => {
    console.log(`MOCHI PROMPT V2 listening on http://localhost:${port}`);
  });
}

void startServer();
