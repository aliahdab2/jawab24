import { describe, it, expect, vi, beforeEach } from 'vitest';
import { templatesService } from '../../src/services/templates';
import { db } from '../../src/db';

vi.mock('../../src/db', () => ({
    db: {
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        select: vi.fn(),
    },
}));

/** Chainable mock helpers */
function mockInsertChain(returnValue: any) {
    return {
        values: vi.fn().mockReturnValue({
            returning: vi.fn().mockResolvedValue([returnValue]),
        }),
    };
}

function mockUpdateChain(returnValue: any) {
    return {
        set: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                returning: vi.fn().mockResolvedValue([returnValue]),
            }),
        }),
    };
}

function mockDeleteChain() {
    return {
        where: vi.fn().mockResolvedValue(undefined),
    };
}

function mockSelectChain(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue(returnValue),
        }),
    };
}

function mockSelectWithOrder(returnValue: any) {
    return {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
                orderBy: vi.fn().mockReturnValue({
                    limit: vi.fn().mockResolvedValue(returnValue),
                }),
            }),
        }),
    };
}

const sampleTemplate = {
    id: 'tpl-1',
    workspaceId: 'ws-1',
    name: 'Welcome',
    message: 'Welcome to our store!',
    active: true,
    createdAt: new Date(),
    updatedAt: new Date(),
};

describe('TemplatesService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createTemplate', () => {
        it('should create a template and return it', async () => {
            vi.mocked(db.insert).mockReturnValue(mockInsertChain(sampleTemplate) as any);

            const result = await templatesService.createTemplate('ws-1', {
                name: 'Welcome',
                message: 'Welcome to our store!',
            });

            expect(result).toEqual(sampleTemplate);
            expect(db.insert).toHaveBeenCalledTimes(1);
        });

        it('should default active to true', async () => {
            const chain = mockInsertChain(sampleTemplate);
            vi.mocked(db.insert).mockReturnValue(chain as any);

            await templatesService.createTemplate('ws-1', {
                name: 'Test',
                message: 'Test msg',
            });

            expect(chain.values).toHaveBeenCalledWith(
                expect.objectContaining({ active: true }),
            );
        });
    });

    describe('getTemplates', () => {
        it('should return all templates for a workspace', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectWithOrder([sampleTemplate]) as any);

            const result = await templatesService.getTemplates('ws-1');

            expect(result).toEqual([sampleTemplate]);
        });

        it('should return empty array when no templates', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectWithOrder([]) as any);

            const result = await templatesService.getTemplates('ws-empty');

            expect(result).toEqual([]);
        });
    });

    describe('getTemplate', () => {
        it('should return a single template by id and workspace', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([sampleTemplate]) as any);

            const result = await templatesService.getTemplate('ws-1', 'tpl-1');

            expect(result).toEqual(sampleTemplate);
        });

        it('should return null when not found', async () => {
            vi.mocked(db.select).mockReturnValue(mockSelectChain([]) as any);

            const result = await templatesService.getTemplate('ws-1', 'missing');

            expect(result).toBeNull();
        });
    });

    describe('updateTemplate', () => {
        it('should update and return the template', async () => {
            const updated = { ...sampleTemplate, message: 'Updated message' };
            vi.mocked(db.update).mockReturnValue(mockUpdateChain(updated) as any);

            const result = await templatesService.updateTemplate('ws-1', 'tpl-1', { message: 'Updated message' });

            expect(result).toEqual(updated);
        });
    });

    describe('deleteTemplate', () => {
        it('should delete the template', async () => {
            vi.mocked(db.delete).mockReturnValue(mockDeleteChain() as any);

            await templatesService.deleteTemplate('ws-1', 'tpl-1');

            expect(db.delete).toHaveBeenCalledTimes(1);
        });
    });
});
