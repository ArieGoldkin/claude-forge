/**
 * Agentation React Integration Examples
 *
 * This file demonstrates different ways to integrate Agentation
 * into the platform web app.
 */

import { Agentation } from 'agentation'
import { useEffect, useState } from 'react'

// ============================================================================
// EXAMPLE 1: Basic Integration (Recommended)
// ============================================================================

/**
 * Simplest integration - add to App.tsx root
 *
 * Location: frontend/web/src/App.tsx
 */
export function AppBasicExample() {
  return (
    <>
      {/* Your existing app structure */}
      <YourApp />

      {/* Development-only annotation tool */}
      {process.env.NODE_ENV === 'development' && <Agentation />}
    </>
  )
}

// ============================================================================
// EXAMPLE 2: DevTools Wrapper Pattern
// ============================================================================

/**
 * Centralized dev tools component
 * Useful when you have multiple dev-only tools
 *
 * Location: frontend/web/src/components/DevTools.tsx
 */
export function DevTools() {
  // Early return for production
  if (process.env.NODE_ENV !== 'development') {
    return null
  }

  return (
    <div className="dev-tools-wrapper">
      <Agentation />
      {/* Add other dev tools here */}
      {/* <ReactQueryDevtools /> */}
      {/* <YourCustomDevPanel /> */}
    </div>
  )
}

// Then in App.tsx:
export function AppWithDevTools() {
  return (
    <>
      <YourApp />
      <DevTools />
    </>
  )
}

// ============================================================================
// EXAMPLE 3: Keyboard Shortcut Activation
// ============================================================================

/**
 * Toggle Agentation with keyboard shortcut (Ctrl+Shift+A)
 * Useful if you want to avoid always-on overlay
 */
export function AppWithKeyboardToggle() {
  const [showAgentation, setShowAgentation] = useState(false)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+Shift+A (Cmd+Shift+A on Mac)
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'A') {
        e.preventDefault()
        setShowAgentation(prev => !prev)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <>
      <YourApp />

      {/* Show hint in dev mode */}
      {process.env.NODE_ENV === 'development' && !showAgentation && (
        <div className="agentation-hint">
          Press Ctrl+Shift+A to activate Agentation
        </div>
      )}

      {/* Render when toggled */}
      {process.env.NODE_ENV === 'development' && showAgentation && (
        <Agentation />
      )}
    </>
  )
}

// ============================================================================
// EXAMPLE 4: Advanced - Custom Callback Integration
// ============================================================================

/**
 * Send annotations to custom API or logging service
 * Useful for automated bug tracking or analytics
 */
interface AnnotationData {
  element: {
    selector: string
    className: string
    tagName: string
    position: {
      x: number
      y: number
      width: number
      height: number
    }
  }
  note: string
  timestamp: number
}

export function AppWithCustomCallback() {
  const handleAnnotation = async (annotation: AnnotationData) => {
    // Log to console
    console.log('New annotation:', annotation)

    // Optional: Send to custom API
    try {
      await fetch('/api/dev/annotations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...annotation,
          user: 'QA',
          environment: 'development',
          url: window.location.href,
        }),
      })
    } catch (error) {
      console.error('Failed to log annotation:', error)
    }

    // Optional: Create Jira ticket automatically
    // await createJiraTicket(annotation)

    // Optional: Send to Slack
    // await sendToSlack(`New UI issue reported: ${annotation.note}`)
  }

  return (
    <>
      <YourApp />

      {process.env.NODE_ENV === 'development' && (
        <Agentation
          onAnnotationAdd={handleAnnotation}
          copyToClipboard={true}  // Still allow manual copy
        />
      )}
    </>
  )
}

// ============================================================================
// EXAMPLE 5: Storybook Integration
// ============================================================================

/**
 * Add Agentation to all Storybook stories
 *
 * Location: frontend/web/.storybook/preview.tsx
 */
import type { Decorator } from '@storybook/react'

export const withAgentation: Decorator = (Story) => {
  return (
    <>
      <Story />
      {process.env.NODE_ENV === 'development' && <Agentation />}
    </>
  )
}

// In .storybook/preview.tsx:
export const decorators = [
  withAgentation,
  // ... other decorators
]

// ============================================================================
// EXAMPLE 6: Conditional Loading Based on Route
// ============================================================================

/**
 * Only load Agentation on specific routes
 * Useful if you only want it during QA of certain features
 */
import { useLocation } from '@tanstack/react-router'

export function AppWithConditionalLoading() {
  const location = useLocation()

  // Only show on routes being QA tested
  const shouldShowAgentation = [
    '/checkout',
    '/action',
    '/insights',
  ].some(route => location.pathname.startsWith(route))

  return (
    <>
      <YourApp />

      {process.env.NODE_ENV === 'development' && shouldShowAgentation && (
        <Agentation />
      )}
    </>
  )
}

// ============================================================================
// EXAMPLE 7: Feature Flag Integration
// ============================================================================

/**
 * Use feature flag to enable/disable Agentation
 * Useful for gradual rollout to team
 */
export function AppWithFeatureFlag() {
  // Replace with your feature flag system
  const isAgentationEnabled = useFeatureFlag('enable-agentation')

  return (
    <>
      <YourApp />

      {process.env.NODE_ENV === 'development' && isAgentationEnabled && (
        <Agentation />
      )}
    </>
  )
}

// Mock feature flag hook (replace with actual implementation)
function useFeatureFlag(flagName: string): boolean {
  // Example: Check localStorage
  return localStorage.getItem(flagName) === 'true'

  // Or check environment variable
  // return process.env[`VITE_${flagName}`] === 'true'

  // Or check API
  // const { data } = useQuery(['feature-flags', flagName])
  // return data?.enabled ?? false
}

// ============================================================================
// EXAMPLE 8: Portal-Based Rendering
// ============================================================================

/**
 * Render Agentation in a portal for better z-index control
 * Rarely needed, but useful for complex overlay scenarios
 */
import { createPortal } from 'react-dom'

export function AppWithPortal() {
  return (
    <>
      <YourApp />

      {process.env.NODE_ENV === 'development' &&
        createPortal(
          <Agentation />,
          document.body  // Render at body level
        )}
    </>
  )
}

// ============================================================================
// HELPER: Styled Wrapper for Better Integration
// ============================================================================

/**
 * Custom styled wrapper for Agentation
 * Add custom styles or branding
 */
export function StyledAgentationWrapper() {
  return (
    <div className="agentation-wrapper" style={{
      // Custom styles
      '--agentation-primary': '#00855B',  // Brand green
      '--agentation-bg': '#1d1f23',
    } as React.CSSProperties}>
      <Agentation />
    </div>
  )
}

// ============================================================================
// HELPER: TypeScript Types
// ============================================================================

/**
 * TypeScript types for Agentation props and callbacks
 */
export interface AgentationProps {
  onAnnotationAdd?: (annotation: AnnotationData) => void
  copyToClipboard?: boolean
}

// Re-export for convenience
export type { AnnotationData }

// ============================================================================
// RECOMMENDED IMPLEMENTATION FOR YOUR PLATFORM
// ============================================================================

/**
 * This is the recommended integration for the platform
 *
 * 1. Simple and clean
 * 2. Development-only (NODE_ENV guard)
 * 3. Always available during dev/QA
 * 4. No performance overhead
 *
 * Add this to: frontend/web/src/App.tsx
 */
export function PlatformIntegration() {
  return (
    <>
      {/* Existing app structure */}
      <div className="app">
        {/* Routes, providers, etc. */}
      </div>

      {/* Agentation - Development only */}
      {process.env.NODE_ENV === 'development' && <Agentation />}
    </>
  )
}

// ============================================================================
// TESTING UTILITIES
// ============================================================================

/**
 * Mock Agentation for testing environments
 * Prevents Agentation from interfering with automated tests
 */
export function MockAgentation() {
  // Render nothing in test environment
  if (process.env.NODE_ENV === 'test') {
    return null
  }

  return <Agentation />
}

// ============================================================================
// DOCUMENTATION STRINGS
// ============================================================================

/**
 * @example
 * // Basic usage in App.tsx
 * import { Agentation } from 'agentation'
 *
 * function App() {
 *   return (
 *     <>
 *       <YourApp />
 *       {process.env.NODE_ENV === 'development' && <Agentation />}
 *     </>
 *   )
 * }
 *
 * @example
 * // With custom callback
 * <Agentation
 *   onAnnotationAdd={(annotation) => {
 *     console.log('Annotation added:', annotation)
 *   }}
 *   copyToClipboard={true}
 * />
 *
 * @see https://agentation.dev for full documentation
 * @see .claude/skills/agentation/SKILL.md for integration guide
 */
