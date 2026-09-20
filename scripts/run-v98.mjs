import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'deliverable/dorms-v98-badge-integration');
const task = process.argv[2];
const entries = {
  qa: 'deep-integration-qa.mjs',
  'qa:motion': 'motion-evidence.mjs',
  'qa:desktop': 'desktop-qa.mjs',
};
if (!entries[task]) throw new Error(`Unknown QA task: ${task}`);
process.chdir(app);

let service;
try {
  if (task !== 'qa:desktop') {
    const { startServer } = await import(pathToFileURL(path.join(app, 'serve.mjs')).href);
    const requestedPort = process.env.DOREUMI_PORT === undefined ? 0 : Number(process.env.DOREUMI_PORT);
    if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
      throw new Error('DOREUMI_PORT must be between 0 and 65535');
    }
    service = await startServer(requestedPort);
    process.env.DOREUMI_PORT = String(service.server.address().port);
    process.env.DOREUMI_BASE_URL = service.url;
  }
  await import(pathToFileURL(path.join(app, 'scripts', entries[task])).href);
} finally {
  if (service) await new Promise((resolve, reject) => service.server.close((error) => error ? reject(error) : resolve()));
}
