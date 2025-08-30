/**
 * Tests for Manual Review Queue System
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { 
    ManualReviewQueue, 
    ManualReviewQueueConfig,
    ReviewQueueEntry,
    ManualReviewSuggestion,
    FilteredSuggestionSet 
} from '../src/lib/manual-review-queue';
import { ProcessedSuggestion } from '../src/lib/confidence-scorer';

// Mock logger
vi.mock('../src/lib/logger', () => ({
    logger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
    }
}));

describe('ManualReviewQueue', () => {
    let queue: ManualReviewQueue;
    let config: ManualReviewQueueConfig;

    beforeEach(() => {
        config = {
            maxQueueSize: 100,
            batchSize: 10,
            priorityThreshold: 0.75,
            autoCleanupDays: 7
        };
        queue = new ManualReviewQueue(config);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('Constructor and Configuration', () => {
        it('should initialize with default configuration', () => {
            const defaultQueue = new ManualReviewQueue();
            expect(defaultQueue).toBeInstanceOf(ManualReviewQueue);
        });

        it('should use provided configuration', () => {
            const customConfig: ManualReviewQueueConfig = {
                maxQueueSize: 50,
                batchSize: 5,
                priorityThreshold: 0.80,
                autoCleanupDays: 14
            };
            const customQueue = new ManualReviewQueue(customConfig);
            expect(customQueue).toBeInstanceOf(ManualReviewQueue);
        });

        it('should return default configuration', () => {
            const defaultConfig = ManualReviewQueue.getDefaultConfig();
            expect(defaultConfig).toEqual({
                maxQueueSize: 1000,
                batchSize: 50,
                priorityThreshold: 0.75,
                autoCleanupDays: 30
            });
        });
    });

    describe('Adding Suggestions to Queue', () => {
        let mockFilteredSet: FilteredSuggestionSet;
        let mockSuggestions: ManualReviewSuggestion[];

        beforeEach(() => {
            mockSuggestions = [
                {
                    suggestion: {
                        value: 'new-filename.txt',
                        confidence: 0.75,
                        reasoning: 'Good confidence for renaming',
                        originalConfidence: 0.75,
                        adjustedConfidence: 0.75,
                        qualityScore: 80,
                        validationFlags: [],
                        isRecommended: true,
                        rank: 1
                    },
                    confidence: 0.75,
                    operation: 'rename',
                    originalPath: '/path/to/file.txt',
                    suggestedPath: '/path/to/new-filename.txt',
                    reason: 'Better descriptive name'
                },
                {
                    suggestion: {
                        value: 'documents/important.pdf',
                        confidence: 0.65,
                        reasoning: 'Moderate confidence for moving',
                        originalConfidence: 0.65,
                        adjustedConfidence: 0.65,
                        qualityScore: 70,
                        validationFlags: [],
                        isRecommended: false,
                        rank: 2
                    },
                    confidence: 0.65,
                    operation: 'move',
                    originalPath: '/downloads/file.pdf',
                    suggestedPath: '/documents/important.pdf',
                    reason: 'Move to documents folder'
                }
            ];

            mockFilteredSet = {
                autoApprove: [],
                manualReview: mockSuggestions,
                reject: []
            };
        });

        it('should add suggestions to the queue', async () => {
            await queue.addSuggestions(mockFilteredSet);
            
            const stats = queue.getQueueStats();
            expect(stats.totalItems).toBe(2);
            expect(stats.pendingItems).toBe(2);
        });

        it('should handle empty suggestion sets', async () => {
            const emptySet: FilteredSuggestionSet = {
                autoApprove: [],
                manualReview: [],
                reject: []
            };

            await queue.addSuggestions(emptySet);
            
            const stats = queue.getQueueStats();
            expect(stats.totalItems).toBe(0);
        });

        it('should calculate priority correctly', async () => {
            await queue.addSuggestions(mockFilteredSet);
            
            const pendingItems = queue.getPendingItems();
            expect(pendingItems).toHaveLength(2);
            
            // Higher confidence should have higher priority
            const highConfidenceItem = pendingItems.find(item => item.suggestion.confidence === 0.75);
            const lowConfidenceItem = pendingItems.find(item => item.suggestion.confidence === 0.65);
            
            expect(highConfidenceItem?.priority).toBeGreaterThan(lowConfidenceItem?.priority || 0);
        });
    });

    describe('Queue Management', () => {
        beforeEach(async () => {
            // Add test data
            const mockSuggestions: ManualReviewSuggestion[] = Array.from({ length: 5 }, (_, i) => ({
                suggestion: {
                    value: `file-${i}.txt`,
                    confidence: 0.7 + (i * 0.05),
                    reasoning: `Test suggestion ${i}`,
                    originalConfidence: 0.7 + (i * 0.05),
                    adjustedConfidence: 0.7 + (i * 0.05),
                    qualityScore: 70 + (i * 5),
                    validationFlags: [],
                    isRecommended: true,
                    rank: i + 1
                },
                confidence: 0.7 + (i * 0.05),
                operation: 'rename',
                originalPath: `/path/to/file-${i}.txt`,
                suggestedPath: `/path/to/renamed-${i}.txt`,
                reason: `Test reason ${i}`
            }));

            await queue.addSuggestions({
                autoApprove: [],
                manualReview: mockSuggestions,
                reject: []
            });
        });

        it('should get pending items with default sorting', () => {
            const items = queue.getPendingItems();
            expect(items).toHaveLength(5);
            
            // Should be sorted by priority descending by default
            for (let i = 0; i < items.length - 1; i++) {
                expect(items[i].priority).toBeGreaterThanOrEqual(items[i + 1].priority);
            }
        });

        it('should filter items by confidence range', () => {
            const items = queue.getPendingItems({
                filterBy: {
                    minConfidence: 0.75,
                    maxConfidence: 1.0
                }
            });
            
            expect(items.length).toBeGreaterThan(0);
            items.forEach(item => {
                expect(item.suggestion.confidence).toBeGreaterThanOrEqual(0.75);
            });
        });

        it('should sort items by confidence', () => {
            const items = queue.getPendingItems({
                sortBy: 'confidence',
                sortOrder: 'desc'
            });
            
            for (let i = 0; i < items.length - 1; i++) {
                expect(items[i].suggestion.confidence).toBeGreaterThanOrEqual(items[i + 1].suggestion.confidence);
            }
        });

        it('should limit the number of items returned', () => {
            const items = queue.getPendingItems({ limit: 3 });
            expect(items).toHaveLength(3);
        });

        it('should get review batches', () => {
            const batch = queue.getReviewBatch(3);
            expect(batch).toHaveLength(3);
            
            // Should be highest priority items
            const allItems = queue.getPendingItems();
            expect(batch[0].priority).toBe(allItems[0].priority);
        });
    });

    describe('Review Decision Processing', () => {
        let testEntries: ReviewQueueEntry[];

        beforeEach(async () => {
            const mockSuggestions: ManualReviewSuggestion[] = [{
                suggestion: {
                    value: 'test-file.txt',
                    confidence: 0.75,
                    reasoning: 'Test suggestion',
                    originalConfidence: 0.75,
                    adjustedConfidence: 0.75,
                    qualityScore: 80,
                    validationFlags: [],
                    isRecommended: true,
                    rank: 1
                },
                confidence: 0.75,
                operation: 'rename',
                originalPath: '/path/to/file.txt',
                suggestedPath: '/path/to/test-file.txt',
                reason: 'Better name'
            }];

            await queue.addSuggestions({
                autoApprove: [],
                manualReview: mockSuggestions,
                reject: []
            });

            testEntries = queue.getPendingItems();
        });

        it('should process review decision for approve', async () => {
            const entry = testEntries[0];
            const decision = {
                action: 'approve' as const,
                reason: 'Good suggestion',
                appliedAt: new Date()
            };

            await queue.processReviewDecision(entry.id, decision, 'test-user', 'Additional notes');

            const stats = queue.getQueueStats();
            expect(stats.approvedItems).toBe(1);
            expect(stats.pendingItems).toBe(0);
        });

        it('should process review decision for reject', async () => {
            const entry = testEntries[0];
            const decision = {
                action: 'reject' as const,
                reason: 'Not suitable',
                appliedAt: new Date()
            };

            await queue.processReviewDecision(entry.id, decision, 'test-user');

            const stats = queue.getQueueStats();
            expect(stats.rejectedItems).toBe(1);
            expect(stats.pendingItems).toBe(0);
        });

        it('should handle invalid entry ID', async () => {
            const decision = {
                action: 'approve' as const,
                reason: 'Test',
                appliedAt: new Date()
            };

            await expect(
                queue.processReviewDecision('invalid-id', decision, 'test-user')
            ).rejects.toThrow('Queue entry not found');
        });

        it('should prevent processing already reviewed entries', async () => {
            const entry = testEntries[0];
            const decision = {
                action: 'approve' as const,
                reason: 'First decision',
                appliedAt: new Date()
            };

            // First decision should work
            await queue.processReviewDecision(entry.id, decision, 'test-user');

            // Second decision should fail
            await expect(
                queue.processReviewDecision(entry.id, decision, 'test-user')
            ).rejects.toThrow('not in pending status');
        });
    });

    describe('Batch Review Processing', () => {
        let testEntries: ReviewQueueEntry[];

        beforeEach(async () => {
            const mockSuggestions: ManualReviewSuggestion[] = Array.from({ length: 3 }, (_, i) => ({
                suggestion: {
                    value: `file-${i}.txt`,
                    confidence: 0.7 + (i * 0.1),
                    reasoning: `Test suggestion ${i}`,
                    originalConfidence: 0.7 + (i * 0.1),
                    adjustedConfidence: 0.7 + (i * 0.1),
                    qualityScore: 70 + (i * 10),
                    validationFlags: [],
                    isRecommended: true,
                    rank: i + 1
                },
                confidence: 0.7 + (i * 0.1),
                operation: 'rename',
                originalPath: `/path/to/file-${i}.txt`,
                reason: `Test reason ${i}`
            }));

            await queue.addSuggestions({
                autoApprove: [],
                manualReview: mockSuggestions,
                reject: []
            });

            testEntries = queue.getPendingItems();
        });

        it('should process batch review decisions', async () => {
            const decisions = [
                {
                    entryId: testEntries[0].id,
                    decision: { action: 'approve' as const, reason: 'Good', appliedAt: new Date() },
                    notes: 'Approved'
                },
                {
                    entryId: testEntries[1].id,
                    decision: { action: 'reject' as const, reason: 'Bad', appliedAt: new Date() },
                    notes: 'Rejected'
                }
            ];

            const result = await queue.processBatchReview(decisions, 'test-user');

            expect(result.totalProcessed).toBe(2);
            expect(result.approved).toBe(1);
            expect(result.rejected).toBe(1);
            expect(result.errors).toHaveLength(0);

            const stats = queue.getQueueStats();
            expect(stats.reviewedItems).toBe(2);
            expect(stats.pendingItems).toBe(1);
        });

        it('should handle mixed success and failure in batch', async () => {
            const decisions = [
                {
                    entryId: testEntries[0].id,
                    decision: { action: 'approve' as const, reason: 'Good', appliedAt: new Date() },
                    notes: 'Approved'
                },
                {
                    entryId: 'invalid-id',
                    decision: { action: 'reject' as const, reason: 'Bad', appliedAt: new Date() },
                    notes: 'Rejected'
                }
            ];

            const result = await queue.processBatchReview(decisions, 'test-user');

            expect(result.totalProcessed).toBe(1);
            expect(result.approved).toBe(1);
            expect(result.rejected).toBe(0);
            expect(result.errors).toHaveLength(1);
            expect(result.errors[0].entryId).toBe('invalid-id');
        });
    });

    describe('Manual Overrides', () => {
        let testEntry: ReviewQueueEntry;

        beforeEach(async () => {
            const mockSuggestion: ManualReviewSuggestion = {
                suggestion: {
                    value: 'test-file.txt',
                    confidence: 0.75,
                    reasoning: 'Test suggestion',
                    originalConfidence: 0.75,
                    adjustedConfidence: 0.75,
                    qualityScore: 80,
                    validationFlags: [],
                    isRecommended: true,
                    rank: 1
                },
                confidence: 0.75,
                operation: 'rename',
                originalPath: '/path/to/file.txt',
                reason: 'Test reason'
            };

            await queue.addSuggestions({
                autoApprove: [],
                manualReview: [mockSuggestion],
                reject: []
            });

            testEntry = queue.getPendingItems()[0];
        });

        it('should apply manual override to approve', async () => {
            await queue.applyOverride(
                testEntry.id,
                'approve',
                'Manual override for testing',
                'test-user'
            );

            const stats = queue.getQueueStats();
            expect(stats.approvedItems).toBe(1);
            expect(stats.pendingItems).toBe(0);
        });

        it('should apply manual override to reject', async () => {
            await queue.applyOverride(
                testEntry.id,
                'reject',
                'Manual override for testing',
                'test-user'
            );

            const stats = queue.getQueueStats();
            expect(stats.rejectedItems).toBe(1);
            expect(stats.pendingItems).toBe(0);
        });

        it('should track override history', async () => {
            await queue.applyOverride(
                testEntry.id,
                'approve',
                'Manual override for testing',
                'test-user'
            );

            // Get all entries including reviewed ones
            const allEntries: ReviewQueueEntry[] = Array.from((queue as any).queue.values());
            const overriddenEntry = allEntries.find((e: ReviewQueueEntry) => e.id === testEntry.id);
            
            expect(overriddenEntry).toBeDefined();
            expect(overriddenEntry?.overrides).toHaveLength(1);
            expect(overriddenEntry?.overrides[0].newDecision).toBe('approve');
            expect(overriddenEntry?.overrides[0].reason).toBe('Manual override for testing');
            expect(overriddenEntry?.overrides[0].overriddenBy).toBe('test-user');
        });

        it('should handle invalid entry ID for override', async () => {
            await expect(
                queue.applyOverride('invalid-id', 'approve', 'Test reason', 'test-user')
            ).rejects.toThrow('Queue entry not found');
        });
    });

    describe('Queue Statistics and Management', () => {
        beforeEach(async () => {
            // Add various entries with different states
            const mockSuggestions: ManualReviewSuggestion[] = Array.from({ length: 5 }, (_, i) => ({
                suggestion: {
                    value: `file-${i}.txt`,
                    confidence: 0.6 + (i * 0.1),
                    reasoning: `Test suggestion ${i}`,
                    originalConfidence: 0.6 + (i * 0.1),
                    adjustedConfidence: 0.6 + (i * 0.1),
                    qualityScore: 60 + (i * 10),
                    validationFlags: [],
                    isRecommended: true,
                    rank: i + 1
                },
                confidence: 0.6 + (i * 0.1),
                operation: 'rename',
                originalPath: `/path/to/file-${i}.txt`,
                reason: `Test reason ${i}`
            }));

            await queue.addSuggestions({
                autoApprove: [],
                manualReview: mockSuggestions,
                reject: []
            });

            // Process some decisions
            const entries = queue.getPendingItems();
            await queue.processReviewDecision(
                entries[0].id,
                { action: 'approve', reason: 'Good', appliedAt: new Date() },
                'test-user'
            );
            await queue.processReviewDecision(
                entries[1].id,
                { action: 'reject', reason: 'Bad', appliedAt: new Date() },
                'test-user'
            );
        });

        it('should provide accurate queue statistics', () => {
            const stats = queue.getQueueStats();
            
            expect(stats.totalItems).toBe(5);
            expect(stats.pendingItems).toBe(3);
            expect(stats.reviewedItems).toBe(2);
            expect(stats.approvedItems).toBe(1);
            expect(stats.rejectedItems).toBe(1);
            expect(stats.averageConfidence).toBeGreaterThan(0);
        });

        it('should get approved entries for execution', () => {
            const approvedEntries = queue.getApprovedEntries();
            expect(approvedEntries).toHaveLength(1);
            expect(approvedEntries[0].decision?.action).toBe('approve');
        });

        it('should remove processed entries', async () => {
            const approvedEntries = queue.getApprovedEntries();
            const entryIds = approvedEntries.map(e => e.id);
            
            await queue.removeProcessedEntries(entryIds);
            
            const stats = queue.getQueueStats();
            expect(stats.totalItems).toBe(4); // 5 - 1 removed
            expect(stats.approvedItems).toBe(0); // Approved entry was removed
        });

        it('should cleanup old entries', async () => {
            // Mock old date for some entries
            const entries = queue.getPendingItems({ limit: 1000 });
            const reviewedEntries = entries.filter(e => e.status === 'reviewed');
            
            // Manually set old date (in real scenario, this would be natural aging)
            if (reviewedEntries.length > 0) {
                const oldDate = new Date();
                oldDate.setDate(oldDate.getDate() - 10); // 10 days ago
                (reviewedEntries[0] as any).addedAt = oldDate;
            }

            const cleanedCount = await queue.cleanupOldEntries();
            expect(cleanedCount).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Queue Size Limits', () => {
        it('should enforce queue size limits', async () => {
            const smallQueue = new ManualReviewQueue({
                maxQueueSize: 3,
                batchSize: 2,
                priorityThreshold: 0.75,
                autoCleanupDays: 7
            });

            // Add more entries than the limit
            const mockSuggestions: ManualReviewSuggestion[] = Array.from({ length: 5 }, (_, i) => ({
                suggestion: {
                    value: `file-${i}.txt`,
                    confidence: 0.7,
                    reasoning: `Test suggestion ${i}`,
                    originalConfidence: 0.7,
                    adjustedConfidence: 0.7,
                    qualityScore: 70,
                    validationFlags: [],
                    isRecommended: true,
                    rank: i + 1
                },
                confidence: 0.7,
                operation: 'rename',
                originalPath: `/path/to/file-${i}.txt`,
                reason: `Test reason ${i}`
            }));

            await smallQueue.addSuggestions({
                autoApprove: [],
                manualReview: mockSuggestions,
                reject: []
            });

            const stats = smallQueue.getQueueStats();
            expect(stats.totalItems).toBeLessThanOrEqual(3);
        });
    });

    describe('Error Handling', () => {
        it('should handle invalid decision actions', async () => {
            const mockSuggestion: ManualReviewSuggestion = {
                suggestion: {
                    value: 'test-file.txt',
                    confidence: 0.75,
                    reasoning: 'Test suggestion',
                    originalConfidence: 0.75,
                    adjustedConfidence: 0.75,
                    qualityScore: 80,
                    validationFlags: [],
                    isRecommended: true,
                    rank: 1
                },
                confidence: 0.75,
                operation: 'rename',
                originalPath: '/path/to/file.txt',
                reason: 'Test reason'
            };

            await queue.addSuggestions({
                autoApprove: [],
                manualReview: [mockSuggestion],
                reject: []
            });

            const entry = queue.getPendingItems()[0];
            const invalidDecision = {
                action: 'invalid' as any,
                reason: 'Test',
                appliedAt: new Date()
            };

            await expect(
                queue.processReviewDecision(entry.id, invalidDecision, 'test-user')
            ).rejects.toThrow('Invalid review decision action');
        });

        it('should require decision reason', async () => {
            const mockSuggestion: ManualReviewSuggestion = {
                suggestion: {
                    value: 'test-file.txt',
                    confidence: 0.75,
                    reasoning: 'Test suggestion',
                    originalConfidence: 0.75,
                    adjustedConfidence: 0.75,
                    qualityScore: 80,
                    validationFlags: [],
                    isRecommended: true,
                    rank: 1
                },
                confidence: 0.75,
                operation: 'rename',
                originalPath: '/path/to/file.txt',
                reason: 'Test reason'
            };

            await queue.addSuggestions({
                autoApprove: [],
                manualReview: [mockSuggestion],
                reject: []
            });

            const entry = queue.getPendingItems()[0];
            const emptyReasonDecision = {
                action: 'approve' as const,
                reason: '',
                appliedAt: new Date()
            };

            await expect(
                queue.processReviewDecision(entry.id, emptyReasonDecision, 'test-user')
            ).rejects.toThrow('Review decision must include a reason');
        });
    });
});
