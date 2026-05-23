import { useEffect, useRef, type RefObject } from 'react';

/**
 * Auto-focus a form element on mount. Skips when `skip` is true — useful for
 * edit forms where the existing value should be preserved instead of being
 * selected and accidentally overtyped.
 *
 * Returns a ref to attach to the element. The element must be focusable.
 *
 * Replaces the inline `useRef + useEffect` pattern duplicated across
 * KeywordChipInput, PhoneInput, OtpInput, FileUploadButton,
 * KnowledgeBaseCustomSection, and CatalogItemForm.
 *
 * @example
 *   const nameRef = useAutoFocus<HTMLInputElement>();
 *   return <input ref={nameRef} ... />;
 *
 * @example
 *   const nameRef = useAutoFocus<HTMLInputElement>(isEdit);  // skip on edit
 *   return <input ref={nameRef} ... />;
 */
export function useAutoFocus<T extends HTMLElement>(skip: boolean = false): RefObject<T | null> {
    const ref = useRef<T | null>(null);
    useEffect(() => {
        if (!skip && ref.current) ref.current.focus();
    }, [skip]);
    return ref;
}
