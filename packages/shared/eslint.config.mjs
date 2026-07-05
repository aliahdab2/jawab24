import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';

/** @type {import('eslint').Linter.Config[]} */
export default [
    js.configs.recommended,
    
    // Ignore patterns
    {
        ignores: ['dist/**', 'node_modules/**'],
    },
    
    // TypeScript files
    {
        files: ['**/*.ts'],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
            globals: {
                // Node.js globals if needed
                console: 'readonly',
                process: 'readonly',
                // CommonJS: this package compiles to CJS (tsconfig module: commonjs);
                // require()/__dirname are legitimate runtime globals (lazy dependency
                // loading; cwd-independent path resolution in tests).
                require: 'readonly',
                __dirname: 'readonly',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint,
        },
        rules: {
            // Turn off base rule in favor of TypeScript version
            'no-unused-vars': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            
            // Best practices
            'prefer-const': 'error',
            'no-console': 'warn',
        },
    },
];
