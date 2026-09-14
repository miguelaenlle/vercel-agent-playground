import { createServer } from 'node:http';
import { createServer as createViteServer } from 'vite';
import { createApp } from '../src/server.js';
import { testModel } from './model.js';

const app = createApp(testModel());
const server = createServer(app);
const vite = await createViteServer({
  server: { middlewareMode: true, hmr: { server } },
});
app.use(vite.middlewares);
server.listen(4311, '127.0.0.1');
