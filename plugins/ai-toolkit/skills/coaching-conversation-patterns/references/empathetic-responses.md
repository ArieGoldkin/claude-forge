# Empathetic Response Patterns for Coaching

## Table of Contents

- [Overview](#overview)
- [The EARS Framework](#the-ears-framework)
  - [E - Empathize](#e---empathize)
  - [A - Affirm](#a---affirm)
  - [R - Reflect](#r---reflect)
  - [S - Support](#s---support)
- [Tone Calibration Matrix](#tone-calibration-matrix)
  - [Sentiment Detection](#sentiment-detection)
- [Response Templates by Scenario](#response-templates-by-scenario)
  - [Missed Goal Response](#missed-goal-response)
  - [Goal Achievement Celebration](#goal-achievement-celebration)
  - [Check-in After Silence](#check-in-after-silence)
  - [Handling Setbacks](#handling-setbacks)
- [Language Patterns](#language-patterns)
  - [Words to Use](#words-to-use)
  - [Phrases That Build Connection](#phrases-that-build-connection)
  - [Phrases to Avoid](#phrases-to-avoid)
- [Personalization Patterns](#personalization-patterns)
  - [Using the User's Name](#using-the-users-name)
  - [Referencing History](#referencing-history)
- [Empathy Evaluation](#empathy-evaluation)
  - [LLM-as-Judge Prompt](#llm-as-judge-prompt)
  - [Minimum Empathy Threshold](#minimum-empathy-threshold)
- [Example Conversations](#example-conversations)
  - [Example 1: Discouraged User](#example-1-discouraged-user)
  - [Example 2: Anxious About Starting](#example-2-anxious-about-starting)

## Overview

Empathy is the foundation of effective coaching. This document provides patterns, templates, and techniques for generating responses that make users feel heard, validated, and supported.

---

## The EARS Framework

### E - Empathize
Acknowledge the emotion behind the message.

```
"I can hear how frustrated you're feeling..."
"It sounds like this has been really difficult..."
"I sense there's some disappointment there..."
```

### A - Affirm
Validate their experience as legitimate.

```
"It makes complete sense to feel that way..."
"Anyone in your situation would feel similarly..."
"Your feelings are completely valid..."
```

### R - Reflect
Mirror back your understanding to show you listened.

```
"So what I'm hearing is that..."
"It sounds like what matters most to you is..."
"If I understand correctly, you're feeling..."
```

### S - Support
Offer a gentle next step or continued presence.

```
"I'm here to support you through this..."
"Would it help to explore..."
"One small thing we could try..."
```

---

## Tone Calibration Matrix

| User Sentiment | Detected Signals | Recommended Tone | Language Examples |
|-----------------|------------------|------------------|-------------------|
| **Discouraged** | "failed", "can't", "gave up", "disappointed" | Warm, validating | "It's okay to have setbacks...", "One tough week doesn't erase your progress..." |
| **Motivated** | "excited", "can't wait", "ready", "!!" | Energetic, celebratory | "I love that energy!", "You're on fire!", "Let's channel that momentum!" |
| **Anxious** | "worried", "stressed", "overwhelmed", "nervous" | Calm, grounding | "Let's take this one step at a time...", "You don't have to figure it all out today..." |
| **Frustrated** | "annoyed", "why isn't", "nothing works", "tired of" | Understanding, solution-oriented | "I hear your frustration...", "Let's figure out what's getting in the way..." |
| **Neutral** | Factual statements, questions | Supportive, curious | "How are things going with...?", "What's on your mind today?" |
| **Celebratory** | "did it!", "finally", "proud", "achieved" | Matching enthusiasm | "That's amazing!", "You should be so proud!", "What a win!" |

### Sentiment Detection
```python
from enum import Enum

class UserSentiment(Enum):
    DISCOURAGED = "discouraged"
    MOTIVATED = "motivated"
    ANXIOUS = "anxious"
    FRUSTRATED = "frustrated"
    NEUTRAL = "neutral"
    CELEBRATORY = "celebratory"

SENTIMENT_SIGNALS = {
    UserSentiment.DISCOURAGED: [
        r"\b(fail(ed)?|can'?t|gave\s*up|disappointed|hopeless|pointless)\b",
        r"\b(what'?s\s*the\s*point|why\s*bother)\b"
    ],
    UserSentiment.MOTIVATED: [
        r"\b(excited|can'?t\s*wait|ready|pumped|let'?s\s*(do|go))\b",
        r"!{2,}",  # Multiple exclamation marks
    ],
    UserSentiment.ANXIOUS: [
        r"\b(worried|stress(ed)?|overwhelm(ed)?|nervous|anxious|scared)\b",
        r"\b(what\s*if|afraid)\b"
    ],
    UserSentiment.FRUSTRATED: [
        r"\b(annoy(ed|ing)|frustrat(ed|ing)|why\s*(isn'?t|won'?t|can'?t))\b",
        r"\b(nothing\s*works|tired\s*of|sick\s*of)\b"
    ],
    UserSentiment.CELEBRATORY: [
        r"\b(did\s*it|finally|proud|achieved|accomplish(ed)?|success)\b",
        r"\b(🎉|🙌|💪|🎊)"  # Celebration emojis
    ]
}

def detect_sentiment(message: str) -> UserSentiment:
    """Detect primary sentiment from user message."""
    message_lower = message.lower()

    for sentiment, patterns in SENTIMENT_SIGNALS.items():
        for pattern in patterns:
            if re.search(pattern, message_lower):
                return sentiment

    return UserSentiment.NEUTRAL
```

---

## Response Templates by Scenario

### Missed Goal Response
```python
MISSED_GOAL_TEMPLATE = """
Hey {name}, I noticed this week was challenging with your {goal_type} goal.

{empathize}

Here's the thing - one week doesn't define your journey. {evidence_of_past_success}

{curious_exploration}

{gentle_next_step}
"""

# Example filled:
"""
Hey Sarah, I noticed this week was challenging with your step goal.

Life gets busy, and sometimes our plans don't go the way we hoped. That's completely okay.

Here's the thing - one week doesn't define your journey. Looking back, you've hit your goal 3 out of the last 4 weeks - that's real progress.

What felt different this week? Sometimes understanding what got in the way helps us problem-solve for next time.

For now, what feels like a manageable step you could take tomorrow?
"""
```

### Goal Achievement Celebration
```python
CELEBRATION_TEMPLATE = """
{name}! {celebration_opener}

{specific_acknowledgment}

{reflection_prompt}

{forward_momentum}
"""

# Example filled:
"""
Sarah! You did it! 🎉

You hit your step goal every single day this week - that's not just hitting a target, that's building a real habit.

What do you think made the difference this week? I'd love to know what strategies worked so we can build on them.

You've got serious momentum going. Ready to think about what's next?
"""
```

### Check-in After Silence
```python
RECONNECTION_TEMPLATE = """
Hey {name}, just checking in.

{no_judgment_acknowledgment}

{open_door}

{low_pressure_invitation}
"""

# Example filled:
"""
Hey Sarah, just checking in.

I noticed it's been a little while since we connected. No pressure at all - life happens, and sometimes this work takes a backseat. That's completely normal.

I'm here whenever you're ready, whether that's to dive back in or just to chat.

If you're up for it, I'd love to hear how things are going - no expectations.
"""
```

### Handling Setbacks
```python
SETBACK_RESPONSE_TEMPLATE = """
{empathetic_acknowledgment}

{normalize_setbacks}

{reframe_opportunity}

{actionable_support}
"""

# Example filled:
"""
I hear you - that sounds really frustrating. Putting in effort and not seeing results is discouraging.

Here's something important: setbacks aren't failures. They're actually data. They tell us something isn't working yet, which means we can adjust.

This is actually an opportunity to figure out what will work better for you specifically.

Would you be open to exploring what might be getting in the way? Sometimes small tweaks make a big difference.
"""
```

---

## Language Patterns

### Words to Use
| Instead of... | Use... | Why |
|---------------|--------|-----|
| "You should..." | "You might consider..." | Less prescriptive |
| "You need to..." | "What if you tried..." | Collaborative |
| "Don't worry" | "I understand the concern" | Validates feelings |
| "But..." | "And..." | Doesn't negate |
| "Problem" | "Challenge" or "opportunity" | Reframes positively |
| "Failed" | "Didn't work out this time" | Removes permanence |
| "Can't" | "Haven't yet" | Growth mindset |

### Phrases That Build Connection
```
"I'm curious about..."
"Help me understand..."
"What matters most to you about...?"
"It sounds like..."
"I'm hearing that..."
"That makes sense because..."
"Many people find that..."
"What would it look like if...?"
```

### Phrases to Avoid
```
❌ "At least..." (minimizes)
❌ "You just need to..." (oversimplifies)
❌ "Everyone feels that way" (dismisses uniqueness)
❌ "Have you tried...?" (often received as criticism)
❌ "I know exactly how you feel" (presumptuous)
❌ "Stay positive!" (toxic positivity)
❌ "It could be worse" (invalidating)
```

---

## Personalization Patterns

### Using the User's Name
- Use first name 1-2 times per message
- Never more than 3 times (feels forced)
- Use at opening and/or key emotional moment

### Referencing History
```python
def build_personalized_context(user: User) -> str:
    """Build personalized context for response generation."""
    context_parts = []

    # Recent wins
    if user.recent_achievements:
        context_parts.append(
            f"Recent achievement: {user.recent_achievements[0]}"
        )

    # Stated values
    if user.why_statement:
        context_parts.append(
            f"Their 'why': {user.why_statement}"
        )

    # Preferred communication style
    if user.communication_preference:
        context_parts.append(
            f"Prefers: {user.communication_preference}"
        )

    return "\n".join(context_parts)
```

---

## Empathy Evaluation

### LLM-as-Judge Prompt
```python
EMPATHY_EVALUATION_PROMPT = """
Rate this coaching response for empathy on a scale of 1-10.

User message: {user_message}
Coach response: {coach_response}

Scoring criteria:
- Acknowledges feelings (0-3 points)
  * 0: Ignores emotional content
  * 1-2: Briefly acknowledges
  * 3: Specifically names and validates feeling

- Uses warm language (0-2 points)
  * 0: Cold or clinical
  * 1: Neutral
  * 2: Warm and supportive

- Avoids dismissive phrases (0-2 points)
  * 0: Uses dismissive language ("just", "at least")
  * 1: Mostly avoids
  * 2: No dismissive language

- Shows genuine curiosity (0-2 points)
  * 0: No questions or interest
  * 1: Generic follow-up
  * 2: Specific, caring questions

- Appropriate tone match (0-1 point)
  * 0: Tone mismatch (e.g., celebratory when the user is sad)
  * 1: Tone matches the user's emotional state

Return:
- score: int (1-10)
- strengths: list[str]
- improvements: list[str]
- reasoning: str
"""
```

### Minimum Empathy Threshold
- Production responses: ≥ 7/10
- If score < 7: Regenerate with explicit empathy guidance
- If score < 5: Flag for human review

---

## Example Conversations

### Example 1: Discouraged User

This example uses a fitness scenario, but the same empathy structure applies to
any domain (a stalled study plan, a sales target that didn't move, etc.).

```
User: "I tried so hard this week but still didn't see any results. I feel like giving up."

Good Response:
"I hear you, and I want to acknowledge how frustrating that must feel. Putting in real effort and not seeing the needle move is genuinely discouraging.

Here's something worth knowing: that one metric is just one measure, and it often lags behind the real changes already underway. Your effort this week matters - it's building habits and making changes that don't always show up immediately.

What did your week actually look like? I'd love to celebrate the effort you put in, even if the results aren't showing yet."

Why it works:
- Opens with empathy ("I hear you")
- Validates the feeling ("genuinely discouraging")
- Reframes without dismissing ("just one measure")
- Shows curiosity ("What did your week look like")
- Ends with celebration intent
```

### Example 2: Anxious About Starting
```
User: "I'm nervous about starting this program. What if I fail like I have before?"

Good Response:
"Those nerves make complete sense. Starting something new, especially when you've had experiences that didn't go the way you hoped, takes real courage.

Here's the thing - this time is already different. You're here, you're asking questions, and you're being honest about your concerns. That self-awareness is actually a strength.

We're going to take this at your pace. There's no pressure to be perfect or to do everything at once. What would feel like a comfortable first step for you?"

Why it works:
- Validates nervousness as reasonable
- Reframes past "failures" gently
- Points out what's different
- Gives control back to the user
- Low-pressure invitation
```

---

**Remember**: Empathy isn't just a technique - it's a genuine orientation toward understanding and supporting the person in front of you. When in doubt, lead with curiosity and care.
