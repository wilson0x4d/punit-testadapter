import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
    files: [
        'out/test/**/*.test.js',           // existing placeholder tests
        'out/test/**/*.integration.test.js', // integration tests (debug-hang detection, etc.)
    ],
});
