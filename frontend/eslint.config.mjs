import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';
import noMixedSemanticPalette from './eslint-rules/no-mixed-semantic-palette.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
});

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
    // Extend Next.js recommended config (includes TypeScript and React plugins)
    ...compat.extends('next/core-web-vitals', 'next/typescript'),
    
    // Global ignores
    {
        ignores: [
            '.next/**',
            'node_modules/**',
            'out/**',
            'public/**',
            '*.config.js',
            '*.config.mjs',
        ],
    },
    
    // Custom rules for all files
    {
        files: ['**/*.{js,jsx,ts,tsx}'],
        plugins: {
            jawab24: { rules: { 'no-mixed-semantic-palette': noMixedSemanticPalette } },
        },
        rules: {
            // Next.js specific
            '@next/next/no-img-element': 'off',
            '@next/next/no-html-link-for-pages': 'warn',
            
            // React
            'react/no-unescaped-entities': 'off',
            'react-hooks/exhaustive-deps': 'warn',
            
            // Design system: a semantic status/alert/icon-bg/notif class must
            // own its hue alone. See frontend/eslint-rules/ and CONVENTIONS.md.
            'jawab24/no-mixed-semantic-palette': 'error',

            // General best practices
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'prefer-const': 'error',
            'no-unused-vars': 'off',
        },
    },
    
    // TypeScript specific overrides
    {
        files: ['**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            '@typescript-eslint/no-explicit-any': 'warn',
        },
    },

    // Relax any rule in test files where mocking often requires it
    {
        files: ['**/*.test.{ts,tsx}', '**/__tests__/**/*.{ts,tsx}'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
        },
    },
];

export default eslintConfig;
