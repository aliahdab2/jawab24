import React from 'react';
import { ALLOWED_AI_MODELS, DEFAULT_AI_MODEL } from '@jawab24/shared';

interface Props {
    /** Localized label appended to the default model option, e.g. "(default)" or "(افتراضي)". */
    defaultLabelSuffix?: string;
}

export function AiModelOptions({ defaultLabelSuffix = '(default)' }: Props) {
    return (
        <>
            {ALLOWED_AI_MODELS.map((m) => (
                <option key={m} value={m}>
                    {m}{m === DEFAULT_AI_MODEL ? ` ${defaultLabelSuffix}` : ''}
                </option>
            ))}
        </>
    );
}
