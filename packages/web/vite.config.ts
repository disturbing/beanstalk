import { cloudflare } from '@cloudflare/vite-plugin';
import vinext from 'vinext';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    vinext(),
    // The RSC environment runs in workerd, so server code reads bindings from cloudflare:workers.
    cloudflare({ viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } }),
  ],
});
