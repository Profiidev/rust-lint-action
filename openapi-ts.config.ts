import { defineConfig } from '@hey-api/openapi-ts';

export default defineConfig({
  input: './forgejo/spec.json',
  logs: './build',
  output: {
    path: 'src/forgejo-client',
    postProcess: ['oxfmt']
  },
  plugins: [
    {
      enums: true,
      name: '@hey-api/typescript'
    },
    {
      name: '@hey-api/sdk'
    },
    {
      bigInt: false,
      name: '@hey-api/transformers'
    },
    {
      baseUrl: '',
      name: '@hey-api/client-fetch'
    }
  ]
});
