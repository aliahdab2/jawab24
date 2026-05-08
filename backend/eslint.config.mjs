import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/', 'node_modules/', 'drizzle/', '**/*.js'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['test/**/*.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            'no-unused-vars': 'off',
        },
    },
    {
        files: ['src/**/*.ts'],
        rules: {
            '@typescript-eslint/no-unused-vars': ['warn', {
                argsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
            '@typescript-eslint/no-explicit-any': 'warn',
            '@typescript-eslint/explicit-function-return-type': 'off',
            '@typescript-eslint/no-non-null-assertion': 'warn',
            '@typescript-eslint/ban-ts-comment': ['warn', {
                'ts-ignore': 'allow-with-description',
            }],
            'no-unused-vars': 'off',
            'no-console': ['warn', { allow: ['warn', 'error'] }],
            'no-undef': 'off',
            'eqeqeq': ['error', 'always'],
            'no-var': 'error',
            'prefer-const': 'warn',
            'no-return-await': 'warn',
        },
    },
);
