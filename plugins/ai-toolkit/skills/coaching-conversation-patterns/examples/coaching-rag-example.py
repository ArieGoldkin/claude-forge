"""
Example: AI Coaching with RAG Context

This example demonstrates a complete coaching conversation flow
with RAG-based context retrieval, safety checks, and quality evaluation.
It uses a fitness scenario for concreteness, but the same flow applies to
any coaching domain (study habits, career, customer onboarding, etc.).
"""

from datetime import datetime
from typing import AsyncIterator
from pydantic import BaseModel
from anthropic import Anthropic

# --- Models ---

class UserProfile(BaseModel):
    user_id: str
    first_name: str
    primary_goals: list[str]
    why_statement: str | None
    coaching_start_date: datetime


class ConversationTurn(BaseModel):
    role: str  # "user" or "coach"
    content: str
    timestamp: datetime


class SafetyCheck(BaseModel):
    passed: bool
    flags: list[str]
    severity: str  # "low", "medium", "high", "critical"
    action: str  # "proceed", "rephrase", "block", "escalate"


class QualityEvaluation(BaseModel):
    empathy_score: int  # 1-10
    safety_score: int  # 1-10
    relevance_score: int  # 1-10
    passed: bool


class CoachingResponse(BaseModel):
    content: str
    tone: str
    safety_check: SafetyCheck
    quality: QualityEvaluation


# --- Safety Detection ---

import re

CRISIS_PATTERNS = [
    r"\b(suicid|kill\s*(myself|me)|end\s*(my\s*)?life)\b",
    r"\b(self[- ]?harm|cut(ting)?\s*myself|hurt\s*myself)\b",
]

MEDICAL_PATTERNS = [
    r"\b(should\s*i\s*(take|stop|change))\s+\w*\s*(medication|medicine)\b",
    r"\b(diagnos|dosage|prescri)\b",
]


def detect_crisis(message: str) -> bool:
    """Detect crisis indicators in message."""
    message_lower = message.lower()
    return any(re.search(p, message_lower) for p in CRISIS_PATTERNS)


def detect_medical_request(message: str) -> bool:
    """Detect medical advice requests."""
    message_lower = message.lower()
    return any(re.search(p, message_lower) for p in MEDICAL_PATTERNS)


# --- RAG Context Retrieval ---

async def get_coaching_context(
    user_id: str,
    message: str,
    vector_db,  # Your vector database client
) -> dict:
    """Retrieve relevant context for personalized coaching."""

    # 1. Get user profile from database
    profile = await get_user_profile(user_id)

    # 2. Search past conversations (semantic search)
    past_conversations = await vector_db.search(
        query=message,
        filter={"user_id": user_id, "type": "conversation"},
        top_k=3
    )

    # 3. Get relevant coaching guidelines
    guidelines = await vector_db.search(
        query=message,
        filter={"type": "coaching_guideline"},
        top_k=2
    )

    # 4. Get recent progress on goals
    goal_progress = await get_goal_progress(user_id)

    return {
        "profile": profile,
        "past_conversations": past_conversations,
        "guidelines": guidelines,
        "goal_progress": goal_progress
    }


async def get_user_profile(user_id: str) -> UserProfile:
    """Fetch user profile from database."""
    # Replace with actual database call
    return UserProfile(
        user_id=user_id,
        first_name="Sarah",
        primary_goals=["Walk 10,000 steps daily", "Reduce stress"],
        why_statement="I want to have more energy for my kids",
        coaching_start_date=datetime(2024, 1, 15)
    )


async def get_goal_progress(user_id: str) -> dict:
    """Fetch recent goal progress."""
    # Replace with actual database call
    return {
        "steps_this_week": 42000,
        "steps_goal": 70000,
        "streak_days": 3,
        "trend": "improving"
    }


# --- Response Generation ---

COACHING_SYSTEM_PROMPT = """
You are a supportive coach. Your role is to help users achieve their
goals through empathetic, evidence-based coaching conversations.

Core principles:
1. Lead with empathy - always acknowledge feelings first
2. Empower, don't prescribe - help users find their own solutions
3. Stay in your lane - never give advice outside your scope (e.g. medical, legal, financial)
4. Safety first - take crisis mentions seriously

User context:
{user_context}

Recent conversation:
{recent_turns}

Respond with warmth, curiosity, and support. Keep responses concise (2-3 paragraphs).
"""


async def generate_coaching_response(
    client: Anthropic,
    user_message: str,
    context: dict,
    recent_turns: list[ConversationTurn]
) -> str:
    """Generate coaching response with context."""

    # Format user context
    user_context = f"""
Name: {context['profile'].first_name}
Goals: {', '.join(context['profile'].primary_goals)}
Why: {context['profile'].why_statement}
Recent progress: {context['goal_progress']['steps_this_week']:,} / {context['goal_progress']['steps_goal']:,} steps this week
Trend: {context['goal_progress']['trend']}
"""

    # Format recent turns
    turns_text = "\n".join([
        f"{t.role.capitalize()}: {t.content}"
        for t in recent_turns[-5:]  # Last 5 turns
    ])

    # Generate response
    response = await client.messages.create(
        model="claude-sonnet-4-20250514",
        max_tokens=500,
        system=COACHING_SYSTEM_PROMPT.format(
            user_context=user_context,
            recent_turns=turns_text
        ),
        messages=[
            {"role": "user", "content": user_message}
        ]
    )

    return response.content[0].text


# --- Quality Evaluation ---

EMPATHY_EVAL_PROMPT = """
Rate this coaching response for empathy (1-10).

User message: {user_message}
Coach response: {coach_response}

Criteria:
- Acknowledges feelings (0-3 points)
- Validates experience (0-3 points)
- Warm, supportive language (0-2 points)
- No dismissive phrases (0-2 points)

Return JSON: {{"score": <int>, "reasoning": "<str>"}}
"""


async def evaluate_response(
    client: Anthropic,
    user_message: str,
    coach_response: str
) -> QualityEvaluation:
    """Evaluate coaching response quality."""

    response = await client.messages.create(
        model="claude-haiku-3-5-20241022",  # Faster model for evaluation
        max_tokens=200,
        messages=[{
            "role": "user",
            "content": EMPATHY_EVAL_PROMPT.format(
                user_message=user_message,
                coach_response=coach_response
            )
        }]
    )

    # Parse response (simplified - use structured output in production)
    import json
    result = json.loads(response.content[0].text)

    return QualityEvaluation(
        empathy_score=result["score"],
        safety_score=10,  # Assume passed if we got here
        relevance_score=8,  # Simplified
        passed=result["score"] >= 7
    )


# --- Main Coaching Flow ---

async def handle_coaching_message(
    user_id: str,
    message: str,
    recent_turns: list[ConversationTurn],
    client: Anthropic,
    vector_db,
) -> CoachingResponse:
    """
    Main entry point for handling a coaching message.

    Flow:
    1. Safety check (crisis, medical)
    2. Retrieve context (RAG)
    3. Generate response
    4. Validate and evaluate
    5. Return or regenerate
    """

    # 1. Safety check - crisis detection
    if detect_crisis(message):
        return CoachingResponse(
            content="""I'm really concerned about what you've shared. Your safety matters.

Please reach out right now:
- 988 Suicide & Crisis Lifeline (call or text)
- Crisis Text Line: Text HOME to 741741

I've notified your coach, who will reach out soon. You're not alone.""",
            tone="concerned",
            safety_check=SafetyCheck(
                passed=False,
                flags=["crisis_indicator"],
                severity="critical",
                action="escalate"
            ),
            quality=QualityEvaluation(
                empathy_score=10,
                safety_score=10,
                relevance_score=10,
                passed=True
            )
        )

    # 2. Safety check - medical advice
    if detect_medical_request(message):
        return CoachingResponse(
            content=f"""I can tell this is important to you, and I want to make sure you get the right guidance.

Questions about medications are really important to get right - your doctor or pharmacist would be the best person to ask.

What I can help with is supporting your overall journey. Is there something in that area I can help you think through?""",
            tone="supportive",
            safety_check=SafetyCheck(
                passed=True,
                flags=["medical_redirect"],
                severity="medium",
                action="proceed"
            ),
            quality=QualityEvaluation(
                empathy_score=8,
                safety_score=10,
                relevance_score=9,
                passed=True
            )
        )

    # 3. Retrieve context
    context = await get_coaching_context(user_id, message, vector_db)

    # 4. Generate response
    response_text = await generate_coaching_response(
        client, message, context, recent_turns
    )

    # 5. Evaluate quality
    quality = await evaluate_response(client, message, response_text)

    # 6. Regenerate if quality too low
    if not quality.passed:
        # Add empathy guidance and regenerate
        response_text = await generate_coaching_response(
            client,
            f"[Respond with extra empathy and warmth] {message}",
            context,
            recent_turns
        )
        quality = await evaluate_response(client, message, response_text)

    return CoachingResponse(
        content=response_text,
        tone="supportive",
        safety_check=SafetyCheck(
            passed=True,
            flags=[],
            severity="low",
            action="proceed"
        ),
        quality=quality
    )


# --- Example Usage ---

async def main():
    """Example usage of the coaching system."""
    from anthropic import Anthropic

    client = Anthropic()

    # Mock vector database (replace with actual implementation)
    class MockVectorDB:
        async def search(self, query, filter, top_k):
            return []

    vector_db = MockVectorDB()

    # Example conversation
    recent_turns = [
        ConversationTurn(
            role="coach",
            content="Hi Sarah! How's your week going with your step goal?",
            timestamp=datetime.now()
        ),
        ConversationTurn(
            role="user",
            content="Not great honestly. I only walked twice this week.",
            timestamp=datetime.now()
        )
    ]

    # Handle new message
    response = await handle_coaching_message(
        user_id="usr_123",
        message="I feel like I'm failing at this whole thing.",
        recent_turns=recent_turns,
        client=client,
        vector_db=vector_db
    )

    print(f"Response: {response.content}")
    print(f"Empathy Score: {response.quality.empathy_score}/10")
    print(f"Safety Passed: {response.safety_check.passed}")


if __name__ == "__main__":
    import asyncio
    asyncio.run(main())
