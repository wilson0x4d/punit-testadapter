import { defineConfig } from '@vscode/test-cli';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
    extensionDevelopmentPath: __dirname,
    workspaceFolder: join(__dirname, 'workspace'),
    files: [
        'out/test/**/*.test.js',
        'out/test/**/*.integration.test.js',
    ],
    mocha: {
        timeout: 30000,
    },
});
