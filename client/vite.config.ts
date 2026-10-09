import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  if (
    mode === 'production' &&
    env.VITE_API_BASE_URL &&
    env.VITE_API_BASE_URL !== '/api/v1'
  )
    throw new Error(
      'Production API URL must be /api/v1 under the same HTTPS origin',
    );
  return {
    plugins: [react()],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': 'http://localhost:5000' },
    },
  };
});
