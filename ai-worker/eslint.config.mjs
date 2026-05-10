import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['dist/', 'node_modules/', '**/*.js'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['src/**/*.ts'],
        rules: {
            'no-unused-vars': 'off',
            'no-console': 'off',
            'no-undef': 'off',
            '@typescript-eslint/no-unused-vars': 'off',
            '@typescript-eslint/no-explicit-any': 'off',
            // ai-worker can't write to the DB directly. Any new OpenAI call
            // site MUST surface { tokensIn, tokensInCached, tokensOut, model }
            // in its response so the backend consumer can log via
            // services/aiUsageLog#logAiUsage. Adding a raw OpenAI client
            // without doing that breaks cost attribution. The four files
            // listed below already follow the contract and are the only
            // allowed raw consumers.
            'no-restricted-imports': ['error', {
                paths: [{
                    name: 'openai',
                    message: "ai-worker callers must surface tokensIn/tokensOut/tokensInCached/model in their response so the backend consumer can log via aiUsageLog.logAiUsage. Add this file to the allowlist in eslint.config.mjs only after verifying it returns those fields.",
                }],
            }],
        },
    },
    {
        // Pre-existing OpenAI call sites that already surface usage tokens
        // in their HTTP response shape. Adding a new file here is a deliberate
        // design decision — the consumer side MUST be updated to log.
        files: [
            'src/services/openai.ts',
            'src/services/translation.ts',
            'src/services/ecommerceToolHandler.ts',
            'src/services/providers/openai-adapter.ts',
        ],
        rules: { 'no-restricted-imports': 'off' },
    },
);
