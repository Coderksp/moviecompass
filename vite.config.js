import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Local development proxies /api to the deployed backend.
//
// Two reasons. The functions under api/ do not run under `vite dev` at all, and
// TMDB is unreachable from some ISPs, so the deployed proxy is the only way to
// get data locally. Routing through Vite rather than calling the deployment
// directly keeps everything same-origin, which matters for auth: the session
// cookie is SameSite=Lax and would not be sent on a cross-origin request.
//
// Point VITE_DEV_API at a different deployment to develop against a preview.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: process.env.VITE_DEV_API || 'https://reelix-k6xy.vercel.app',
        changeOrigin: true,
        secure: true,
      },
    },
  },
})
