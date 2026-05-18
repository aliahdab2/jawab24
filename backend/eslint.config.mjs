import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/', 'node_modules/', 'drizzle/', '**/*.js'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
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
            // Force every direct OpenAI call through `services/openaiClient`
            // (`makeTrackedOpenAI`). The wrapper auto-logs to ai_usage_log;
            // raw clients silently bypass cost attribution.
            'no-restricted-imports': ['error', {
                paths: [{
                    name: 'openai',
                    message: "Import `makeTrackedOpenAI` from 'src/services/openaiClient' instead. Raw OpenAI clients bypass ai_usage_log and break per-customer cost attribution.",
                }],
            }],
        },
    },
    {
        // Wrapper module is the canonical place for raw OpenAI clients. The
        // other files listed here are pre-existing call sites that already
        // log to ai_usage_log via direct logAiUsage() calls — they're tracked,
        // just not through the wrapper. Migrating them is a separate cleanup;
        // for now they're allowed because they're not leaking. New files
        // adding raw OpenAI imports MUST use the wrapper instead.
        files: [
            'src/services/openaiClient.ts',
            'src/services/kb/embedding.ts',
            'src/services/leadExtractor.ts',
            'src/services/transcription.ts',
        ],
        rules: { 'no-restricted-imports': 'off' },
    },
    {
        // Operator CLI scripts: console.log is the intended I/O for these
        // tools (they're invoked manually, not served as part of the app).
        // Forcing them through Fastify's logger would make them harder to
        // read and pipe.
        files: ['src/scripts/**/*.ts'],
        rules: { 'no-console': 'off' },
    },
);
