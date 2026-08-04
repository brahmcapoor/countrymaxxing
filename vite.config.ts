import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves a project site from /<repo-name>/, not the domain
  // root — every asset URL needs this prefix or they 404 once deployed.
  base: '/countrymaxxing/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // Default globPatterns don't include woff2 — without this the
      // self-hosted fonts (src/index.css) build fine but never make it into
      // the service worker's precache, silently defeating the whole point.
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
      manifest: {
        name: 'CountryMaxxing',
        short_name: 'CountryMaxxing',
        description: '197 countries. Zero frequent flyer miles.',
        theme_color: '#16171d',
        background_color: '#16171d',
        display: 'standalone',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
})
