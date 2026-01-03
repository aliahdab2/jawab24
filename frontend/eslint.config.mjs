import { dirname } from 'path';
import { fileURLToPath } from 'url';
import { FlatCompat } from '@eslint/eslintrc';
import js from '@eslint/js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
});

/** @type {import('eslint').Linter.Config[]} */
const eslintConfig = [
    // Extend Next.js recommended config
    ...compat.extends('next/core-web-vitals'),
    
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
        rules: {
            // Next.js specific
            '@next/next/no-img-element': 'off',
            '@next/next/no-html-link-for-pages': 'warn',
            
            // React
            'react/no-unescaped-entities': 'off',
            'react-hooks/exhaustive-deps': 'warn',
            
            // TypeScript - handled by TS compiler
            '@typescript-eslint/no-unused-vars': ['warn', { 
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            '@typescript-eslint/no-explicit-any': 'off',
            
            // General best practices
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'prefer-const': 'error',
            'no-unused-vars': 'off',
        },
    },
];

export default eslintConfig;

