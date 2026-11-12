import { defineConfig } from 'vite';

// host: true expõe o servidor na rede local, para testar no celular
export default defineConfig({
  server: { host: true, port: 5173, fs: { allow: ['..'] } },
});
