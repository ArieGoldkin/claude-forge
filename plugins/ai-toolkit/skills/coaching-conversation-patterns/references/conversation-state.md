# Conversation State Management for AI Coaching

## Table of Contents

- [Overview](#overview)
- [State Architecture](#state-architecture)
- [State Schema](#state-schema)
- [State Updates](#state-updates)
- [Context Window Management](#context-window-management)
- [Session Summarization](#session-summarization)
- [State Persistence](#state-persistence)
- [RAG Integration for Context](#rag-integration-for-context)
- [Sentiment Tracking](#sentiment-tracking)


## Overview

Managing conversation state is critical for coherent, personalized coaching interactions. This document covers patterns for tracking, persisting, and utilizing conversation context across multi-turn coaching sessions.

---

## State Architecture

### Three-Tier Memory System

```
┌─────────────────────────────────────────────────────────────────┐
│                     LONG-TERM MEMORY                            │
│  (Persisted in database, retrieved via RAG)                     │
│                                                                 │
│  • User profile (demographics, preferences)                     │
│  • Historical goals and outcomes                                │
│  • Communication style preferences                              │
│  • Key life events and context                                  │
│  • Past coaching insights                                       │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ RAG Retrieval
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MEDIUM-TERM MEMORY                           │
│  (Session-level, summarized periodically)                       │
│                                                                 │
│  • Current active goals                                         │
│  • Recent commitments and action items                          │
│  • Session objectives                                           │
│  • Topics discussed this session                                │
│  • Sentiment trajectory                                         │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ Always in context
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    SHORT-TERM MEMORY                            │
│  (Last N turns, always included)                                │
│                                                                 │
│  • Last 5-10 conversation turns                                 │
│  • Immediate context                                            │
│  • Current emotional state                                      │
│  • In-progress topics                                           │
└─────────────────────────────────────────────────────────────────┘
```

---

## State Schema

### Core Conversation State
```python
from pydantic import BaseModel, Field
from datetime import datetime
from enum import Enum

class Sentiment(Enum):
    POSITIVE = "positive"
    NEUTRAL = "neutral"
    CONCERNED = "concerned"
    DISTRESSED = "distressed"

class ConversationTurn(BaseModel):
    """Single turn in conversation."""
    role: str  # "user" or "coach"
    content: str
    timestamp: datetime
    sentiment: Sentiment | None = None
    topics: list[str] = []

class ActionItem(BaseModel):
    """Commitment or action from conversation."""
    description: str
    created_at: datetime
    due_date: datetime | None = None
    status: str = "pending"  # pending, completed, skipped
    related_goal_id: str | None = None

class ConversationState(BaseModel):
    """Full conversation state for a coaching session."""

    # Identifiers
    session_id: str
    user_id: str
    started_at: datetime
    last_activity: datetime

    # Conversation history
    turns: list[ConversationTurn] = []

    # Session context
    current_topic: str | None = None
    topics_discussed: list[str] = []
    session_objective: str | None = None

    # Emotional tracking
    sentiment_trajectory: list[Sentiment] = []
    current_sentiment: Sentiment = Sentiment.NEUTRAL
    sentiment_change_detected: bool = False

    # Goals and commitments
    goals_discussed: list[str] = []
    active_goal_ids: list[str] = []
    commitments_made: list[ActionItem] = []

    # Safety and escalation
    safety_flags: list[str] = []
    needs_human_review: bool = False
    escalation_reason: str | None = None

    # Metadata
    turn_count: int = 0
    coach_model_version: str = "1.0.0"
```

### User Profile (Long-term)
```python
class UserProfile(BaseModel):
    """Persistent user information for personalization."""

    user_id: str

    # Demographics
    first_name: str
    preferred_name: str | None = None
    timezone: str = "UTC"

    # Domain context
    primary_goals: list[str] = []
    why_statement: str | None = None  # Their motivation
    relevant_conditions: list[str] = []  # For context, not treatment

    # Communication preferences
    preferred_tone: str = "supportive"  # supportive, direct, casual
    communication_frequency: str = "regular"  # daily, regular, minimal
    best_contact_time: str | None = None

    # Coaching history
    coaching_start_date: datetime
    sessions_completed: int = 0
    major_achievements: list[str] = []
    known_barriers: list[str] = []

    # Engagement patterns
    typical_response_length: str = "medium"  # short, medium, long
    engagement_level: str = "active"  # new, active, declining, at-risk
```

---

## State Updates

### Turn Processing
```python
async def process_user_turn(
    state: ConversationState,
    message: str
) -> ConversationState:
    """Process incoming user message and update state."""

    # 1. Detect sentiment
    sentiment = await detect_sentiment(message)

    # 2. Extract topics
    topics = await extract_topics(message)

    # 3. Check for safety concerns
    safety_check = await check_safety(message)

    # 4. Create turn record
    turn = ConversationTurn(
        role="user",
        content=message,
        timestamp=datetime.utcnow(),
        sentiment=sentiment,
        topics=topics
    )

    # 5. Update state
    state.turns.append(turn)
    state.turn_count += 1
    state.last_activity = datetime.utcnow()

    # Track sentiment changes
    if state.sentiment_trajectory:
        if sentiment != state.sentiment_trajectory[-1]:
            state.sentiment_change_detected = True
    state.sentiment_trajectory.append(sentiment)
    state.current_sentiment = sentiment

    # Update topics
    for topic in topics:
        if topic not in state.topics_discussed:
            state.topics_discussed.append(topic)
    if topics:
        state.current_topic = topics[0]

    # Handle safety flags
    if safety_check.flags:
        state.safety_flags.extend(safety_check.flags)
        if safety_check.severity in ["high", "critical"]:
            state.needs_human_review = True
            state.escalation_reason = safety_check.reason

    return state
```

### Commitment Extraction
```python
COMMITMENT_EXTRACTION_PROMPT = """
Analyze this conversation exchange and extract any commitments the user made.

User message: {user_message}
Coach response: {coach_response}

Look for:
- Specific actions they agreed to take
- Goals they set
- Timeframes mentioned
- Measurable outcomes

Return a list of ActionItem objects, or empty list if no commitments.
"""

async def extract_commitments(
    user_message: str,
    coach_response: str
) -> list[ActionItem]:
    """Extract commitments from conversation."""
    result = await llm.with_structured_output(list[ActionItem]).ainvoke(
        COMMITMENT_EXTRACTION_PROMPT.format(
            user_message=user_message,
            coach_response=coach_response
        )
    )
    return result
```

---

## Context Window Management

### Token Budget Strategy
```python
TOKEN_BUDGETS = {
    "short_term_memory": 2000,    # Recent turns
    "medium_term_memory": 1000,   # Session context
    "long_term_memory": 1500,     # RAG retrieved
    "system_prompt": 800,         # Coaching persona
    "response_buffer": 700,       # For generation
    # Total: ~6000 tokens (fits in 8k context)
}

def build_context_window(
    state: ConversationState,
    user_profile: UserProfile,
    rag_context: list[Document]
) -> str:
    """Build optimized context window for response generation."""

    context_parts = []

    # 1. System prompt (always first)
    context_parts.append(COACHING_SYSTEM_PROMPT)

    # 2. User profile summary
    profile_summary = summarize_profile(user_profile)
    context_parts.append(f"## User Context\n{profile_summary}")

    # 3. RAG-retrieved context
    if rag_context:
        rag_summary = format_rag_context(rag_context)
        context_parts.append(f"## Relevant History\n{rag_summary}")

    # 4. Session context
    session_summary = summarize_session(state)
    context_parts.append(f"## Current Session\n{session_summary}")

    # 5. Recent conversation (last N turns)
    recent_turns = get_recent_turns(state, max_tokens=TOKEN_BUDGETS["short_term_memory"])
    context_parts.append(f"## Recent Conversation\n{recent_turns}")

    return "\n\n".join(context_parts)
```

### Conversation Truncation
```python
def get_recent_turns(
    state: ConversationState,
    max_tokens: int = 2000
) -> str:
    """Get recent turns that fit in token budget."""

    formatted_turns = []
    total_tokens = 0

    # Work backwards from most recent
    for turn in reversed(state.turns):
        turn_text = f"{turn.role.capitalize()}: {turn.content}"
        turn_tokens = count_tokens(turn_text)

        if total_tokens + turn_tokens > max_tokens:
            break

        formatted_turns.insert(0, turn_text)
        total_tokens += turn_tokens

    return "\n\n".join(formatted_turns)
```

---

## Session Summarization

### Mid-Session Summary
```python
SESSION_SUMMARY_PROMPT = """
Summarize this coaching conversation for context continuity.

Conversation:
{conversation_text}

Include:
1. Main topics discussed
2. User's current emotional state
3. Goals or commitments mentioned
4. Key insights or breakthroughs
5. Open questions or concerns

Keep the summary concise (150-200 words).
"""

async def summarize_session(state: ConversationState) -> str:
    """Generate summary of session so far."""
    conversation_text = format_turns(state.turns)

    summary = await llm.ainvoke(
        SESSION_SUMMARY_PROMPT.format(conversation_text=conversation_text)
    )

    return summary.content
```

### End-of-Session Summary
```python
END_SESSION_SUMMARY_PROMPT = """
Create a comprehensive summary of this coaching session for the user's record.

Conversation:
{conversation_text}

Include:
1. Session date and duration
2. Primary topics covered
3. Goals discussed or set
4. Commitments made by the user
5. Action items for follow-up
6. User's sentiment/emotional journey
7. Recommended focus for next session

Format as structured JSON for storage.
"""

class SessionSummary(BaseModel):
    session_id: str
    date: datetime
    duration_minutes: int
    topics: list[str]
    goals_discussed: list[str]
    commitments: list[ActionItem]
    sentiment_journey: str
    next_session_focus: str
    notes: str
```

---

## State Persistence

### Database Schema
```sql
-- Conversation sessions
CREATE TABLE coaching_sessions (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP,
    status VARCHAR(20) DEFAULT 'active',
    session_summary JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Individual turns
CREATE TABLE conversation_turns (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES coaching_sessions(id),
    role VARCHAR(10) NOT NULL,  -- 'user' or 'coach'
    content TEXT NOT NULL,
    sentiment VARCHAR(20),
    topics TEXT[],
    timestamp TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Commitments and action items
CREATE TABLE coaching_commitments (
    id UUID PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES coaching_sessions(id),
    user_id UUID NOT NULL REFERENCES users(id),
    description TEXT NOT NULL,
    due_date DATE,
    status VARCHAR(20) DEFAULT 'pending',
    related_goal_id UUID REFERENCES goals(id),
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- Indexes for retrieval
CREATE INDEX idx_sessions_user ON coaching_sessions(user_id);
CREATE INDEX idx_turns_session ON conversation_turns(session_id);
CREATE INDEX idx_commitments_user ON coaching_commitments(user_id);
CREATE INDEX idx_turns_timestamp ON conversation_turns(timestamp DESC);
```

### State Recovery
```python
async def recover_session_state(session_id: str) -> ConversationState | None:
    """Recover conversation state from database."""

    # Get session
    session = await db.fetch_one(
        "SELECT * FROM coaching_sessions WHERE id = $1",
        session_id
    )

    if not session:
        return None

    # Get turns
    turns = await db.fetch_all(
        """
        SELECT * FROM conversation_turns
        WHERE session_id = $1
        ORDER BY timestamp ASC
        """,
        session_id
    )

    # Get commitments
    commitments = await db.fetch_all(
        "SELECT * FROM coaching_commitments WHERE session_id = $1",
        session_id
    )

    # Reconstruct state
    state = ConversationState(
        session_id=session_id,
        user_id=session["user_id"],
        started_at=session["started_at"],
        last_activity=turns[-1]["timestamp"] if turns else session["started_at"],
        turns=[
            ConversationTurn(
                role=t["role"],
                content=t["content"],
                timestamp=t["timestamp"],
                sentiment=Sentiment(t["sentiment"]) if t["sentiment"] else None,
                topics=t["topics"] or []
            )
            for t in turns
        ],
        commitments_made=[
            ActionItem(
                description=c["description"],
                created_at=c["created_at"],
                due_date=c["due_date"],
                status=c["status"]
            )
            for c in commitments
        ],
        turn_count=len(turns)
    )

    return state
```

---

## RAG Integration for Context

### Relevant History Retrieval
```python
async def get_coaching_context(
    user_id: str,
    current_message: str
) -> CoachingContext:
    """Retrieve relevant context for personalized coaching."""

    # 1. Get user profile
    profile = await get_user_profile(user_id)

    # 2. Search past conversations
    past_conversations = await vector_search(
        query=current_message,
        filters={
            "user_id": user_id,
            "type": "conversation_summary"
        },
        top_k=3
    )

    # 3. Get relevant commitments
    commitments = await get_recent_commitments(user_id, days=30)

    # 4. Get progress on active goals
    goal_progress = await get_goal_progress(user_id)

    return CoachingContext(
        profile=profile,
        past_conversations=past_conversations,
        recent_commitments=commitments,
        goal_progress=goal_progress
    )
```

---

## Sentiment Tracking

### Trajectory Analysis
```python
def analyze_sentiment_trajectory(
    trajectory: list[Sentiment]
) -> dict:
    """Analyze sentiment changes over conversation."""

    if len(trajectory) < 2:
        return {"trend": "stable", "notable_changes": []}

    # Sentiment values for calculation
    sentiment_values = {
        Sentiment.POSITIVE: 2,
        Sentiment.NEUTRAL: 1,
        Sentiment.CONCERNED: 0,
        Sentiment.DISTRESSED: -1
    }

    values = [sentiment_values[s] for s in trajectory]

    # Calculate trend
    start_avg = sum(values[:3]) / min(3, len(values))
    end_avg = sum(values[-3:]) / min(3, len(values))

    if end_avg > start_avg + 0.5:
        trend = "improving"
    elif end_avg < start_avg - 0.5:
        trend = "declining"
    else:
        trend = "stable"

    # Find notable changes
    notable_changes = []
    for i in range(1, len(trajectory)):
        if trajectory[i] != trajectory[i-1]:
            notable_changes.append({
                "turn": i,
                "from": trajectory[i-1].value,
                "to": trajectory[i].value
            })

    return {
        "trend": trend,
        "notable_changes": notable_changes,
        "current": trajectory[-1].value if trajectory else "unknown"
    }
```

---

**Remember**: Good state management enables personalized, coherent coaching. Always persist important context and retrieve it thoughtfully.
