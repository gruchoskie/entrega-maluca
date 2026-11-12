// Sobe servidor e cliente juntos: `node scripts/dev.mjs` (ou `npm run dev` na raiz).
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const filhos = ['server', 'client'].map((pasta) => {
  const p = spawn(npm, ['--prefix', pasta, 'run', 'dev'], { stdio: 'inherit', shell: process.platform === 'win32' });
  p.on('exit', (c) => process.exit(c ?? 0));
  return p;
});
process.on('SIGINT', () => filhos.forEach((f) => f.kill()));
