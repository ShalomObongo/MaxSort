/**
 * Manual Review Queue System
 * 
 * Manages suggestions that require manual review, providing queue management,
 * override capabilities, and batch processing for efficient manual review workflow.
 */

import { logger } from './logger';
import { FilteredSuggestion } from './confidence-threshold-config';
import { ProcessedSuggestion } from './confidence-scorer';

// Define types needed for manual review queue
export interface FilteredSuggestionSet {
    autoApprove: ProcessedSuggestion[];
    manualReview: ManualReviewSuggestion[];
    reject: ProcessedSuggestion[];
}

export interface ManualReviewSuggestion {
    suggestion: ProcessedSuggestion;
    confidence: number;
    operation: string;
    originalPath: string;
    suggestedPath?: string;
    reason: string;
}

export interface ReviewDecision {
    action: 'approve' | 'reject';
    reason: string;
    appliedAt: Date;
}

export interface ReviewQueueEntry {
    id: string;
    suggestion: ManualReviewSuggestion;
    addedAt: Date;
    status: 'pending' | 'reviewed';
    priority: number;
    reviewedAt?: Date;
    reviewedBy?: string;
    decision?: ReviewDecision;
    notes?: string;
    overrides: ReviewOverride[];
}

export interface BatchReviewResult {
    totalProcessed: number;
    approved: number;
    rejected: number;
    errors: Array<{
        entryId: string;
        error: string;
    }>;
}

export interface ManualReviewQueueConfig {
    maxQueueSize: number;
    batchSize: number;
    priorityThreshold: number;
    autoCleanupDays: number;
}

export interface QueueStats {
    totalItems: number;
    pendingItems: number;
    reviewedItems: number;
    approvedItems: number;
    rejectedItems: number;
    averageConfidence: number;
    oldestEntryAge: number;
}

export interface ReviewOverride {
    entryId: string;
    originalDecision: 'auto-approve' | 'manual-review' | 'reject';
    newDecision: 'approve' | 'reject';
    reason: string;
    overriddenBy: string;
    overriddenAt: Date;
}

/**
 * Manages manual review queue for confidence-filtered suggestions
 */
export class ManualReviewQueue {
    private queue: Map<string, ReviewQueueEntry> = new Map();
    private config: ManualReviewQueueConfig;
    private category: string = 'ManualReviewQueue';

    constructor(config: ManualReviewQueueConfig = ManualReviewQueue.getDefaultConfig()) {
        this.config = config;
    }

    static getDefaultConfig(): ManualReviewQueueConfig {
        return {
            maxQueueSize: 1000,
            batchSize: 50,
            priorityThreshold: 0.75,
            autoCleanupDays: 30
        };
    }

    /**
     * Add suggestions to the manual review queue
     */
    async addSuggestions(filteredSet: FilteredSuggestionSet): Promise<void> {
        try {
            const manualReviewSuggestions = filteredSet.manualReview;
            logger.info(this.category, `Adding ${manualReviewSuggestions.length} suggestions to manual review queue`);

            for (const suggestion of manualReviewSuggestions) {
                await this.addToQueue(suggestion);
            }

            // Enforce queue size limits
            await this.enforceQueueLimits();
            
            logger.info(this.category, `Queue now contains ${this.queue.size} items for manual review`);
        } catch (error) {
            logger.error(this.category, 'Failed to add suggestions to manual review queue', error instanceof Error ? error : undefined);
            throw error;
        }
    }

    /**
     * Add a single suggestion to the queue
     */
    private async addToQueue(suggestion: ManualReviewSuggestion): Promise<void> {
        const entry: ReviewQueueEntry = {
            id: this.generateEntryId(),
            suggestion,
            addedAt: new Date(),
            status: 'pending',
            priority: this.calculatePriority(suggestion),
            reviewedAt: undefined,
            reviewedBy: undefined,
            decision: undefined,
            notes: undefined,
            overrides: []
        };

        this.queue.set(entry.id, entry);
    }

    /**
     * Get pending items from the queue, optionally filtered and sorted
     */
    getPendingItems(options: {
        limit?: number;
        sortBy?: 'priority' | 'confidence' | 'addedAt';
        sortOrder?: 'asc' | 'desc';
        filterBy?: {
            minConfidence?: number;
            maxConfidence?: number;
            operationType?: string;
            fileType?: string;
        };
    } = {}): ReviewQueueEntry[] {
        let items = Array.from(this.queue.values())
            .filter(entry => entry.status === 'pending');

        // Apply filters
        if (options.filterBy) {
            const { minConfidence, maxConfidence, operationType, fileType } = options.filterBy;
            
            items = items.filter(entry => {
                const suggestion = entry.suggestion;
                
                if (minConfidence !== undefined && suggestion.confidence < minConfidence) return false;
                if (maxConfidence !== undefined && suggestion.confidence > maxConfidence) return false;
                if (operationType && suggestion.operation !== operationType) return false;
                if (fileType && !suggestion.originalPath.toLowerCase().includes(fileType.toLowerCase())) return false;
                
                return true;
            });
        }

        // Apply sorting
        const sortBy = options.sortBy || 'priority';
        const sortOrder = options.sortOrder || 'desc';
        
        items.sort((a, b) => {
            let comparison = 0;
            
            switch (sortBy) {
                case 'priority':
                    comparison = a.priority - b.priority;
                    break;
                case 'confidence':
                    comparison = a.suggestion.confidence - b.suggestion.confidence;
                    break;
                case 'addedAt':
                    comparison = a.addedAt.getTime() - b.addedAt.getTime();
                    break;
            }
            
            return sortOrder === 'desc' ? -comparison : comparison;
        });

        // Apply limit
        if (options.limit) {
            items = items.slice(0, options.limit);
        }

        return items;
    }

    /**
     * Get a batch of items for review
     */
    getReviewBatch(batchSize?: number): ReviewQueueEntry[] {
        const size = batchSize || this.config.batchSize;
        return this.getPendingItems({ 
            limit: size, 
            sortBy: 'priority',
            sortOrder: 'desc'
        });
    }

    /**
     * Process a review decision for a queue entry
     */
    async processReviewDecision(
        entryId: string, 
        decision: ReviewDecision,
        reviewedBy: string,
        notes?: string
    ): Promise<void> {
        try {
            const entry = this.queue.get(entryId);
            if (!entry) {
                throw new Error(`Queue entry not found: ${entryId}`);
            }

            if (entry.status !== 'pending') {
                throw new Error(`Entry ${entryId} is not in pending status: ${entry.status}`);
            }

            // Validate decision
            this.validateReviewDecision(entry, decision);

            // Update entry
            entry.status = 'reviewed';
            entry.decision = decision;
            entry.reviewedAt = new Date();
            entry.reviewedBy = reviewedBy;
            entry.notes = notes;

            logger.info(this.category, `Processed review decision for ${entryId}: ${decision.action}`);
        } catch (error) {
            logger.error(this.category, `Failed to process review decision for ${entryId}`, error instanceof Error ? error : undefined);
            throw error;
        }
    }

    /**
     * Process batch review decisions
     */
    async processBatchReview(
        decisions: Array<{
            entryId: string;
            decision: ReviewDecision;
            notes?: string;
        }>,
        reviewedBy: string
    ): Promise<BatchReviewResult> {
        const result: BatchReviewResult = {
            totalProcessed: 0,
            approved: 0,
            rejected: 0,
            errors: []
        };

        try {
            logger.info(this.category, `Processing batch review for ${decisions.length} entries`);

            for (const { entryId, decision, notes } of decisions) {
                try {
                    await this.processReviewDecision(entryId, decision, reviewedBy, notes);
                    result.totalProcessed++;
                    
                    if (decision.action === 'approve') {
                        result.approved++;
                    } else if (decision.action === 'reject') {
                        result.rejected++;
                    }
                } catch (error) {
                    result.errors.push({
                        entryId,
                        error: error instanceof Error ? error.message : String(error)
                    });
                }
            }

            logger.info(this.category, `Batch review completed: ${result.totalProcessed} processed, ${result.approved} approved, ${result.rejected} rejected, ${result.errors.length} errors`);
            return result;
        } catch (error) {
            logger.error(this.category, 'Failed to process batch review', error instanceof Error ? error : undefined);
            throw error;
        }
    }

    /**
     * Apply manual override to change a decision
     */
    async applyOverride(
        entryId: string,
        newDecision: 'approve' | 'reject',
        reason: string,
        overriddenBy: string
    ): Promise<void> {
        try {
            const entry = this.queue.get(entryId);
            if (!entry) {
                throw new Error(`Queue entry not found: ${entryId}`);
            }

            const originalDecision = this.getOriginalDecision(entry);
            
            const override: ReviewOverride = {
                entryId,
                originalDecision,
                newDecision,
                reason,
                overriddenBy,
                overriddenAt: new Date()
            };

            entry.overrides.push(override);
            
            // Update entry decision
            entry.decision = {
                action: newDecision,
                reason,
                appliedAt: new Date()
            };
            entry.status = 'reviewed';
            entry.reviewedAt = new Date();
            entry.reviewedBy = overriddenBy;

            logger.info(this.category, `Applied override to ${entryId}: ${originalDecision} -> ${newDecision}`);
        } catch (error) {
            logger.error(this.category, `Failed to apply override to ${entryId}`, error instanceof Error ? error : undefined);
            throw error;
        }
    }

    /**
     * Get queue statistics
     */
    getQueueStats(): QueueStats {
        const entries = Array.from(this.queue.values());
        const pendingEntries = entries.filter(e => e.status === 'pending');
        const reviewedEntries = entries.filter(e => e.status === 'reviewed');
        const approvedEntries = reviewedEntries.filter(e => e.decision?.action === 'approve');
        const rejectedEntries = reviewedEntries.filter(e => e.decision?.action === 'reject');

        const totalConfidence = entries.reduce((sum, entry) => sum + entry.suggestion.confidence, 0);
        const averageConfidence = entries.length > 0 ? totalConfidence / entries.length : 0;

        const oldestEntry = entries.reduce((oldest, entry) => 
            !oldest || entry.addedAt < oldest.addedAt ? entry : oldest, 
            undefined as ReviewQueueEntry | undefined
        );
        const oldestEntryAge = oldestEntry ? Date.now() - oldestEntry.addedAt.getTime() : 0;

        return {
            totalItems: entries.length,
            pendingItems: pendingEntries.length,
            reviewedItems: reviewedEntries.length,
            approvedItems: approvedEntries.length,
            rejectedItems: rejectedEntries.length,
            averageConfidence,
            oldestEntryAge
        };
    }

    /**
     * Get approved entries for batch execution
     */
    getApprovedEntries(): ReviewQueueEntry[] {
        return Array.from(this.queue.values())
            .filter(entry => 
                entry.status === 'reviewed' && 
                entry.decision?.action === 'approve'
            );
    }

    /**
     * Remove entries from queue after successful execution
     */
    async removeProcessedEntries(entryIds: string[]): Promise<void> {
        try {
            for (const entryId of entryIds) {
                this.queue.delete(entryId);
            }
            logger.info(this.category, `Removed ${entryIds.length} processed entries from queue`);
        } catch (error) {
            logger.error(this.category, 'Failed to remove processed entries', error instanceof Error ? error : undefined);
            throw error;
        }
    }

    /**
     * Clean up old entries based on configuration
     */
    async cleanupOldEntries(): Promise<number> {
        try {
            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - this.config.autoCleanupDays);

            const entriesToRemove = Array.from(this.queue.values())
                .filter(entry => 
                    entry.status === 'reviewed' && 
                    entry.addedAt < cutoffDate
                );

            for (const entry of entriesToRemove) {
                this.queue.delete(entry.id);
            }

            logger.info(this.category, `Cleaned up ${entriesToRemove.length} old entries`);
            return entriesToRemove.length;
        } catch (error) {
            logger.error(this.category, 'Failed to cleanup old entries', error instanceof Error ? error : undefined);
            throw error;
        }
    }

    // Private helper methods

    private generateEntryId(): string {
        return `review-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }

    private calculatePriority(suggestion: ManualReviewSuggestion): number {
        // Higher confidence suggestions get higher priority
        // Priority range: 0-100
        return Math.round(suggestion.confidence * 100);
    }

    private async enforceQueueLimits(): Promise<void> {
        if (this.queue.size <= this.config.maxQueueSize) {
            return;
        }

        const entries = Array.from(this.queue.values());
        const toRemove = this.queue.size - this.config.maxQueueSize;
        
        // First try to remove oldest reviewed entries
        const reviewedEntries = entries
            .filter(entry => entry.status === 'reviewed')
            .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());

        let removed = 0;
        for (let i = 0; i < Math.min(toRemove, reviewedEntries.length); i++) {
            this.queue.delete(reviewedEntries[i].id);
            removed++;
        }

        // If we still need to remove more, remove oldest pending entries
        if (removed < toRemove) {
            const pendingEntries = entries
                .filter(entry => entry.status === 'pending')
                .sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime());

            const stillToRemove = toRemove - removed;
            for (let i = 0; i < Math.min(stillToRemove, pendingEntries.length); i++) {
                this.queue.delete(pendingEntries[i].id);
                removed++;
            }
        }

        logger.info(this.category, `Enforced queue limits: removed ${removed} old entries`);
    }

    private validateReviewDecision(entry: ReviewQueueEntry, decision: ReviewDecision): void {
        if (!['approve', 'reject'].includes(decision.action)) {
            throw new Error(`Invalid review decision action: ${decision.action}`);
        }

        if (!decision.reason || decision.reason.trim().length === 0) {
            throw new Error('Review decision must include a reason');
        }
    }

    private getOriginalDecision(entry: ReviewQueueEntry): 'auto-approve' | 'manual-review' | 'reject' {
        // Since this is in the manual review queue, it was categorized as manual-review
        return 'manual-review';
    }
}
