/**
 * Reusable React Hooks
 * 
 * These hooks follow best practices:
 * - Single responsibility
 * - Proper cleanup
 * - TypeScript support
 * - JSDoc documentation
 */

export { useEscapeKey } from './useEscapeKey';
export { useClickOutside } from './useClickOutside';
export { useIOSPaymentRedirect } from './useIOSPaymentRedirect';
export { useLandscape } from './useLandscape';
export { useBodyScrollLock } from './useBodyScrollLock';
export { useModalBackHandler, dismissTopModal } from './useModalBackHandler';
export { useSwipe } from './useSwipe';
export { useArrowKeyNavigation } from './useArrowKeyNavigation';
export { useDebounce } from './useDebounce';
export { useInfiniteScrollObserver } from './useInfiniteScrollObserver';
export { useSSE } from './useSSE';
export { useTheme } from './useTheme';
export { useIsDarkMode } from './useIsDarkMode';
export { useConversationActions } from './useConversationActions';
export { useMobileMessages } from './useMobileMessages';
export { useWorkspaceRole } from './useWorkspaceRole';
export { useWorkspacesRefresh } from './useWorkspacesRefresh';
export { useNewLeadsSummary, type NewLeadsSummary } from './useNewLeadsSummary';
export { useOwnerGate } from './useOwnerGate';
export { useHintDisplay } from './useHintDisplay';
export { useTextareaAutoResize } from './useTextareaAutoResize';
export { useMultilingualSettingsField } from './useMultilingualSettingsField';
export { useClampOverflow } from './useClampOverflow';
export { usePostReplySetup, type PostReplySetup } from './usePostReplySetup';
export { useOpenOnQueryParam } from './useOpenOnQueryParam';
export { useNotificationPoller } from './useNotificationPoller';
export { useCountdown } from './useCountdown';
export { usePageFilter } from './usePageFilter';
export { useIsEmbedded } from './useIsEmbedded';
export { useHandoffPauseDuration } from './useHandoffPauseDuration';
export { useLeadAlertsEnabled } from './useLeadAlertsEnabled';
export { useCommentReplyMode, useDualReplyNudge, type CommentReplyMode } from './useCommentReplyMode';
export { useLoadConversation } from './useLoadConversation';
export { useDeepLinkParam } from './useDeepLinkParam';
export { useDeepLinkResource } from './useDeepLinkResource';
export { useUrlSelectedResource } from './useUrlSelectedResource';
export { useConnectedStore } from './useConnectedStore';
export { usePersistedBoolean } from './usePersistedBoolean';
export { useSaveKnowledgeBase } from './useSaveKnowledgeBase';
export { useAiPipelineLabel } from './useAiPipelineLabel';
export { useCopyToClipboard } from './useCopyToClipboard';
export { useSubscriptionUsage } from './useSubscriptionUsage';
export { useNavBadgeCounts, aggregateNavBadge, resolveNavHref, type NavBadge, type NavBadgeMap, type NavBadgeColor } from './useNavBadgeCounts';
export { useDashboardLanguageSync } from './useDashboardLanguageSync';
