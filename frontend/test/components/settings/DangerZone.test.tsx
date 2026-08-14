import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { DangerZone } from '../../../src/components/settings/DangerZone';
import EN_SETTINGS from '../../../src/i18n/en/settings.json';

/**
 * The confirm button only enables once "DELETE" is typed, so every case here has
 * to walk the real modal: open it, type the word, press the danger button.
 */
async function confirmDelete() {
    fireEvent.click(screen.getByRole('button', { name: EN_SETTINGS.deleteAccount }));
    fireEvent.change(await screen.findByPlaceholderText(EN_SETTINGS.deleteConfirmPlaceholder), {
        target: { value: 'DELETE' },
    });
    // Both the danger-zone trigger and the modal's confirm carry the same label;
    // the confirm is the one inside the modal, i.e. last in DOM order.
    const buttons = screen.getAllByRole('button', { name: EN_SETTINGS.deleteAccount });
    const confirm = buttons[buttons.length - 1];
    expect(confirm).not.toBeDisabled();
    fireEvent.click(confirm);
}

describe('DangerZone', () => {
    it('shows the success state only when the delete actually succeeded', async () => {
        render(<DangerZone onDeleteAccount={vi.fn().mockResolvedValue(true)} saving={false} />);

        await confirmDelete();

        await waitFor(() => {
            expect(screen.getByText(EN_SETTINGS.deleteSuccess)).toBeInTheDocument();
        });
    });

    it('closes the modal without claiming success when the delete was refused', async () => {
        // A demo session gets 403 DEMO_DELETE_FORBIDDEN, and any other failure
        // resolves false too. Showing "Account Deleted Successfully" over a
        // refused delete told the user their account was gone when it was not.
        //
        // The discriminator has to be the DIALOG, not the success text: with the
        // old always-succeed behaviour the modal stayed open on the success
        // screen, which also unmounts the confirm input — so "input is gone" and
        // a bare "success text is absent" both pass either way. Waiting for the
        // dialog to disappear is what the buggy version cannot satisfy.
        const onDeleteAccount = vi.fn().mockResolvedValue(false);
        render(<DangerZone onDeleteAccount={onDeleteAccount} saving={false} />);

        await confirmDelete();

        expect(onDeleteAccount).toHaveBeenCalledOnce();
        await waitFor(() => {
            expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        });
        expect(screen.queryByText(EN_SETTINGS.deleteSuccess)).not.toBeInTheDocument();
    });

    it('keeps the modal open on the success screen when the delete succeeded', async () => {
        render(<DangerZone onDeleteAccount={vi.fn().mockResolvedValue(true)} saving={false} />);

        await confirmDelete();

        expect(await screen.findByText(EN_SETTINGS.deleteSuccess)).toBeInTheDocument();
        expect(screen.getByRole('dialog')).toBeInTheDocument();
    });
});
