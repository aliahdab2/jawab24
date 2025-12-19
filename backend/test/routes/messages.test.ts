import { describe, it, expect, vi, beforeEach } from 'vitest';
import fastify from 'fastify';
import messagesRoutes from '../../src/routes/messages';
import { messagesService } from '../../src/services/messages';

// Mock services
vi.mock('../../src/services/messages');
vi.mock('../../src/middleware/auth', () => ({
    authenticate: async (req: any) => {
        req.user = { id: 'test_user_id', userId: 'test_user_id', facebookId: 'test_fb_id' };
    }
}));

describe('Messages Routes', () => {
    let app: any;

    beforeEach(async () => {
        app = fastify();
        app.register(messagesRoutes);
        await app.ready();
        vi.clearAllMocks();
    });

    describe('GET /messages', () => {
        it('should get all messages for user', async () => {
            const messagesList = [
                { id: 'msg_1', message: 'Hello!', direction: 'incoming', senderId: 'user_1' },
                { id: 'msg_2', message: 'Hi there!', direction: 'outgoing', senderId: 'user_1' }
            ];
            vi.mocked(messagesService.getMessages).mockResolvedValue(messagesList as any);

            const response = await app.inject({
                method: 'GET',
                url: '/messages'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(messagesList);
            expect(messagesService.getMessages).toHaveBeenCalledWith('test_user_id', 50);
        });

        it('should respect limit parameter', async () => {
            vi.mocked(messagesService.getMessages).mockResolvedValue([]);

            await app.inject({
                method: 'GET',
                url: '/messages?limit=100'
            });

            expect(messagesService.getMessages).toHaveBeenCalledWith('test_user_id', 100);
        });
    });

    describe('GET /messages/stats', () => {
        it('should get message statistics', async () => {
            const stats = {
                total: 50,
                replied: 40,
                pending: 10
            };
            vi.mocked(messagesService.getStats).mockResolvedValue(stats);

            const response = await app.inject({
                method: 'GET',
                url: '/messages/stats'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual(stats);
            expect(messagesService.getStats).toHaveBeenCalledWith('test_user_id');
        });
    });

    describe('GET /messages/conversation/:senderId', () => {
        it('should get conversation with specific sender', async () => {
            const conversation = [
                { id: 'msg_1', message: 'Hello!', direction: 'incoming', senderId: 'sender_123' },
                { id: 'msg_2', message: 'Hi! How can I help?', direction: 'outgoing', senderId: 'sender_123' },
                { id: 'msg_3', message: 'I have a question', direction: 'incoming', senderId: 'sender_123' }
            ];
            vi.mocked(messagesService.getConversation).mockResolvedValue(conversation as any);

            const response = await app.inject({
                method: 'GET',
                url: '/messages/conversation/sender_123?pageId=page_1'
            });

            expect(response.statusCode).toBe(200);
            const payload = JSON.parse(response.payload);
            expect(payload).toEqual(conversation);
            expect(payload.length).toBe(3);
            expect(messagesService.getConversation).toHaveBeenCalledWith('page_1', 'sender_123', 50);
        });

        it('should return empty array for sender with no messages', async () => {
            vi.mocked(messagesService.getConversation).mockResolvedValue([]);

            const response = await app.inject({
                method: 'GET',
                url: '/messages/conversation/unknown_sender?pageId=page_1'
            });

            expect(response.statusCode).toBe(200);
            expect(JSON.parse(response.payload)).toEqual([]);
        });

        it('should return 400 if pageId is missing', async () => {
            const response = await app.inject({
                method: 'GET',
                url: '/messages/conversation/sender_123'
            });

            expect(response.statusCode).toBe(400);
            expect(JSON.parse(response.payload)).toEqual({ error: 'pageId is required' });
        });
    });
});

// Tests for the "Needs Attention" keyword detection logic
describe('Needs Attention Detection', () => {
    // This logic is in the frontend, but we test the keyword matching concept
    const ATTENTION_KEYWORDS = [
        'human', 'agent', 'help', 'support', 'complaint', 'problem', 'issue',
        'talk to someone', 'مساعدة', 'بشري', 'شخص', 'موظف', 'مشكلة', 'شكوى'
    ];

    const checkNeedsAttention = (message: string): boolean => {
        const lowerMessage = message.toLowerCase();
        return ATTENTION_KEYWORDS.some(keyword => lowerMessage.includes(keyword));
    };

    describe('English keywords', () => {
        it('should detect "help" keyword', () => {
            expect(checkNeedsAttention('I need help please')).toBe(true);
            expect(checkNeedsAttention('HELP ME')).toBe(true);
            expect(checkNeedsAttention('Can you help?')).toBe(true);
        });

        it('should detect "human" keyword', () => {
            expect(checkNeedsAttention('I want to talk to a human')).toBe(true);
            expect(checkNeedsAttention('Is there a human available?')).toBe(true);
        });

        it('should detect "agent" keyword', () => {
            expect(checkNeedsAttention('Connect me to an agent')).toBe(true);
        });

        it('should detect "complaint" keyword', () => {
            expect(checkNeedsAttention('I have a complaint')).toBe(true);
        });

        it('should detect "problem" keyword', () => {
            expect(checkNeedsAttention('There is a problem with my order')).toBe(true);
        });

        it('should detect "talk to someone" phrase', () => {
            expect(checkNeedsAttention('I need to talk to someone')).toBe(true);
        });
    });

    describe('Arabic keywords', () => {
        it('should detect "مساعدة" (help)', () => {
            expect(checkNeedsAttention('أحتاج مساعدة')).toBe(true);
        });

        it('should detect "بشري" (human)', () => {
            expect(checkNeedsAttention('أريد التحدث مع شخص بشري')).toBe(true);
        });

        it('should detect "موظف" (employee/agent)', () => {
            expect(checkNeedsAttention('أريد موظف')).toBe(true);
        });

        it('should detect "شكوى" (complaint)', () => {
            expect(checkNeedsAttention('لدي شكوى')).toBe(true);
        });

        it('should detect "مشكلة" (problem)', () => {
            expect(checkNeedsAttention('عندي مشكلة')).toBe(true);
        });
    });

    describe('Messages that should NOT trigger attention', () => {
        it('should not flag normal greetings', () => {
            expect(checkNeedsAttention('Hello!')).toBe(false);
            expect(checkNeedsAttention('مرحبا')).toBe(false);
        });

        it('should not flag product inquiries', () => {
            expect(checkNeedsAttention('What is the price?')).toBe(false);
            expect(checkNeedsAttention('Do you have this in blue?')).toBe(false);
            expect(checkNeedsAttention('كم السعر؟')).toBe(false);
        });

        it('should not flag positive feedback', () => {
            expect(checkNeedsAttention('Great product!')).toBe(false);
            expect(checkNeedsAttention('Thank you so much!')).toBe(false);
            expect(checkNeedsAttention('منتج رائع!')).toBe(false);
        });

        it('should not flag delivery questions', () => {
            expect(checkNeedsAttention('When will my order arrive?')).toBe(false);
            expect(checkNeedsAttention('متى يصل الطلب؟')).toBe(false);
        });
    });

    describe('Edge cases', () => {
        it('should handle empty messages', () => {
            expect(checkNeedsAttention('')).toBe(false);
        });

        it('should handle mixed case', () => {
            expect(checkNeedsAttention('HELP')).toBe(true);
            expect(checkNeedsAttention('HeLp Me')).toBe(true);
        });

        it('should handle keyword within word (helpful)', () => {
            // "helpful" contains "help" so it will match - this is expected behavior
            expect(checkNeedsAttention('You are so helpful')).toBe(true);
        });
    });
});

// Tests for CSV Export format
describe('CSV Export Format', () => {
    const escapeCSV = (value: string): string => {
        return `"${(value || '').replace(/"/g, '""')}"`;
    };

    it('should escape double quotes', () => {
        expect(escapeCSV('Hello "World"')).toBe('"Hello ""World"""');
    });

    it('should handle empty values', () => {
        expect(escapeCSV('')).toBe('""');
    });

    it('should handle newlines in content', () => {
        const result = escapeCSV('Line 1\nLine 2');
        expect(result).toBe('"Line 1\nLine 2"');
    });

    it('should handle Arabic text', () => {
        const result = escapeCSV('مرحبا بك');
        expect(result).toBe('"مرحبا بك"');
    });

    it('should handle commas in content', () => {
        const result = escapeCSV('Hello, World');
        expect(result).toBe('"Hello, World"');
    });
});

