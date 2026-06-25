# Agentation Usage Guide

## Table of Contents

- [Quick Reference](#quick-reference)
- [Basic Workflow](#basic-workflow)
- [Advanced Features](#advanced-features)
- [Workflows by Role](#workflows-by-role)
- [Best Practices](#best-practices)
- [Integration with Claude Code](#integration-with-claude-code)
- [Keyboard Shortcuts](#keyboard-shortcuts)
- [Tips & Tricks](#tips-tricks)
- [Common Issues & Solutions](#common-issues-solutions)
- [Next Steps](#next-steps)
- [Support](#support)


How to use Agentation for visual feedback and QA workflows.

## Quick Reference

| Action | How To |
|--------|--------|
| Activate tool | Click toolbar (bottom-right corner) |
| Select element | Click any UI element |
| Add note | Type feedback in text box |
| Copy output | Click "Copy" button |
| Paste to Claude | Cmd+V / Ctrl+V in Claude Code |
| Freeze animations | Click "Freeze" button |
| Clear annotations | Click "Clear All" |

## Basic Workflow

### Step 1: Identify Issue

**Scenario:** QA finds bug in web app

Example:
- Submit button doesn't show loading state
- Form validation message is cut off
- Navigation menu link is broken

### Step 2: Activate Agentation

1. Open app in development mode
2. Look for toolbar in bottom-right corner
3. Click toolbar to activate

**Expected result:** Overlay appears, elements highlight on hover

### Step 3: Click Element

1. Hover over problematic element
2. Element highlights with blue border
3. Click to select

**Tips:**
- Click directly on element (not child text)
- Use "Freeze" button for animated elements
- Can select multiple elements for comparison

### Step 4: Add Feedback Note

1. Text box appears after clicking element
2. Type clear, specific description
3. Include:
   - What's wrong
   - Expected behavior
   - Steps to reproduce (if applicable)

**Example note:**
```
Button doesn't show spinner when clicked. Should display
loading state during form submission (500ms API call).
To reproduce: Fill form and click submit.
```

### Step 5: Copy Structured Output

1. Click "Copy" button in toolbar
2. Output copied to clipboard
3. Formatted as markdown with selectors

**Output format:**
```markdown
## Issue: Button loading state missing

**Element:** `button.submit-btn-primary`
**Selector:** `.checkout-form > button.submit-btn-primary`
**Position:** x: 340, y: 520, width: 120, height: 40
**Note:** Button doesn't show spinner when clicked. Should display
loading state during form submission (500ms API call).
To reproduce: Fill form and click submit.
```

### Step 6: Share with Developer

**Option A: Paste directly to Claude Code**
```
[In Claude Code chat]
User: Here's a bug found in QA:

[Paste Agentation output]

Can you find and fix the loading state issue?
```

**Option B: Add to Jira ticket**
```
[Jira Description]
## Bug Report

[Paste Agentation output]

Priority: Medium
Affects: Checkout flow, user experience
```

**Option C: Slack thread**
```
[#engineering channel]
@dev-name Found an issue in the checkout form:

[Paste Agentation output]

Can you take a look?
```

## Advanced Features

### Multi-Element Selection

**Use case:** Compare two similar elements

**How to:**
1. Click first element → Add note
2. Click "Add Another" button
3. Click second element → Add note
4. Both elements included in output

**Example output:**
```markdown
## Element 1: Primary CTA
**Selector:** `.header-nav > button.cta-primary`
**Note:** Has correct styling

## Element 2: Secondary CTA
**Selector:** `.sidebar-nav > button.cta-secondary`
**Note:** Missing hover state (should match Element 1)
```

### Text Selection Mode

**Use case:** Annotate specific text content

**How to:**
1. Click "Text Mode" in toolbar
2. Highlight text with mouse
3. Add note about text issue
4. Tool captures text + surrounding element

**Example:**
```markdown
## Text Issue: Typo in error message

**Text:** "Thier password is incorrect"
**Element:** `.error-message`
**Note:** "Thier" should be "Their"
```

### Freeze Mode (Animations)

**Use case:** Capture specific state of animated UI

**How to:**
1. Click "Freeze" button
2. Animation pauses
3. Click element in desired state
4. Add note
5. Click "Unfreeze" to resume

**Examples:**
- Loading spinners
- Hover states
- Transition frames
- Modal animations

### Batch Annotations

**Use case:** Multiple issues on same page

**How to:**
1. Click element #1 → Add note
2. Click "Add Another"
3. Click element #2 → Add note
4. Repeat for all issues
5. Click "Copy All"

**Output includes all annotations:**
```markdown
## Batch Feedback: Checkout Page Issues

### Issue 1: Submit button
**Element:** `.submit-btn`
**Note:** Missing loading state

### Issue 2: Error message
**Element:** `.error-text`
**Note:** Text cutoff at mobile width

### Issue 3: Back button
**Element:** `.back-link`
**Note:** Wrong color (should be secondary)
```

## Workflows by Role

### QA Engineer Workflow

**Goal:** File precise bug reports

**Process:**
1. Test feature in dev environment
2. Find bugs
3. For each bug:
   - Activate Agentation
   - Click problematic element
   - Add reproduction steps
   - Copy output
4. Create Jira tickets with output
5. Assign to developer
6. Developer uses output with Claude

**Time savings:** 30-45 min per bug (less back-and-forth)

### Designer Workflow

**Goal:** Review implementation accuracy

**Process:**
1. Open implemented design in dev
2. Compare to Figma mockups
3. For each discrepancy:
   - Annotate element
   - Note difference (color, spacing, font, etc.)
   - Reference Figma spec
4. Batch all feedback
5. Share with frontend developer

**Example annotation:**
```markdown
## Design Review: Button Spacing

**Element:** `.cta-primary`
**Note:** 8px padding should be 12px per Figma spec.
Figma link: [figma.com/file/xxx#node-id=123]
```

### Developer Workflow

**Goal:** Self-service bug fixing with Claude

**Process:**
1. Notice UI issue during development
2. Activate Agentation
3. Click element
4. Add note with expected behavior
5. Copy output
6. Paste to Claude Code
7. Claude finds exact component + line number
8. Review and apply fix

**Example conversation:**
```
Developer: I have a styling issue:

[Paste Agentation output]

Claude: Found the component at:
frontend/web/src/components/Button.tsx:42

The padding is set to 8px, should be 12px.
Change line 42:
- padding: 8px 16px;
+ padding: 12px 16px;

Developer: Perfect, thanks!
```

## Best Practices

### ✅ Do

1. **Be specific in notes**
   - ✅ "Button should show spinner during 500ms API call"
   - ❌ "Button doesn't work"

2. **Include repro steps**
   - ✅ "To reproduce: Fill form, click submit, observe no spinner"
   - ❌ "Just click it"

3. **One issue per annotation**
   - ✅ Separate annotations for button style vs. button logic
   - ❌ Combine multiple unrelated issues

4. **Add context when helpful**
   - ✅ "Expected: Match primary button in header (green #00855B)"
   - ❌ "Wrong color"

5. **Include Figma references**
   - ✅ "Per Figma spec [link], padding should be 12px"
   - ❌ "Looks wrong"

### ❌ Don't

1. **Vague descriptions**
   - ❌ "This is broken"
   - ✅ "Loading state not showing during form submission"

2. **Multiple issues in one note**
   - ❌ "Button wrong color, text cutoff, hover not working"
   - ✅ Create 3 separate annotations

3. **Skip reproduction steps**
   - ❌ "Form validation broken"
   - ✅ "Fill form, leave email empty, click submit → no validation message"

4. **Forget to include expected behavior**
   - ❌ "Button looks weird"
   - ✅ "Button should match primary CTA style (12px padding, #00855B)"

5. **Annotate production** (impossible with NODE_ENV guard, but still)
   - ❌ Never annotate production site
   - ✅ Always use development environment

## Integration with Claude Code

### Optimal Prompt Structure

```
[Your introduction]
I found a UI issue during [testing/review/development]:

[Paste Agentation output]

[Your request]
Can you:
1. Locate the component file
2. Identify the specific issue
3. Suggest a fix

[Optional context]
This is part of [feature/flow/page].
```

### What Claude Receives

```markdown
## Issue: Submit button missing loading state

**Element:** `button.checkout-submit-btn`
**Selector:** `.checkout-form > button.checkout-submit-btn`
**Position:** x: 340, y: 520, width: 120, height: 40
**Note:** Button doesn't show spinner when clicked. Should display
loading state during form submission (500ms API call).
```

### What Claude Does

1. **Searches codebase** for `.checkout-submit-btn` class
2. **Finds component** file and line number
3. **Analyzes** surrounding code
4. **Identifies** missing loading state prop
5. **Suggests** specific fix with exact line numbers
6. **Applies** fix (if approved)

### Time Comparison

**Without Agentation:**
1. Dev: "Which button?" (5 min)
2. QA: "The submit button in checkout" (2 min)
3. Dev: "I see 3 submit buttons" (3 min)
4. QA: *sends screenshot* (5 min)
5. Dev: *searches for button* (10 min)
6. Claude: *analyzes code* (2 min)
7. **Total: 27 minutes**

**With Agentation:**
1. QA: *pastes annotation* (30 sec)
2. Claude: *finds code instantly* (30 sec)
3. **Total: 1 minute**

**Time saved: 26 minutes per issue**

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Esc` | Close/deactivate Agentation |
| `Enter` | Confirm annotation |
| `Ctrl/Cmd + C` | Copy output |
| `Ctrl/Cmd + Z` | Undo last annotation |
| `Delete` | Remove selected annotation |

## Tips & Tricks

### Tip 1: Use with Storybook

**Benefit:** Review components in isolation

```
1. Open Storybook
2. Navigate to component
3. Activate Agentation
4. Test all variants
5. Annotate issues
```

### Tip 2: Screenshot Context

**For complex layouts:**
1. Annotate element
2. Take screenshot of full page
3. Include screenshot with annotation output
4. Helps Claude understand surrounding context

### Tip 3: Combine with Browser DevTools

**Workflow:**
1. Use DevTools to inspect element
2. Identify CSS issue
3. Use Agentation to capture element
4. Include CSS property in note

**Example note:**
```
Element has `z-index: 1` but should be `z-index: 10`
to appear above modal overlay. (Checked in DevTools)
```

### Tip 4: Export for Later

**If not ready to file bug:**
1. Create all annotations
2. Copy output
3. Save to text file
4. File bugs later as batch

## Common Issues & Solutions

**Issue:** Can't click element (another element in front)

**Solution:** Use Freeze mode, or temporarily hide overlapping element in DevTools

---

**Issue:** Selector too long/complex

**Solution:** Tool captures most specific selector. If too complex, add simpler class in note

---

**Issue:** Element moves before clicking

**Solution:** Use Freeze mode to pause animations/transitions

---

**Issue:** Need to annotate responsive behavior

**Solution:** Create separate annotations for each breakpoint:
- Desktop (>= 768px)
- Mobile (< 768px)

---

**Issue:** Multiple similar elements

**Solution:** Use Position data in output to distinguish (x, y coordinates)

## Next Steps

1. ✅ Read usage guide (this doc)
2. → Try annotating a known issue
3. → Paste to Claude and observe results
4. → Train team on workflow
5. → Measure time savings

## Support

**Questions:** Ask in #engineering Slack
**Bug with Agentation:** https://github.com/benjitaylor/agentation/issues
**Feedback:** Share in trial metrics tracking
