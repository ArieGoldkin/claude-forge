# Coaching Methodologies for AI Coaching

## Table of Contents

- [Overview](#overview)
- [Motivational Interviewing (MI)](#motivational-interviewing-mi)
- [SMART Goals Framework](#smart-goals-framework)
- [Stages of Change (Transtheoretical Model)](#stages-of-change-transtheoretical-model)
- [Behavioral Change Techniques](#behavioral-change-techniques)
- [Coaching Conversation Structure](#coaching-conversation-structure)
- [AI Coaching Boundaries](#ai-coaching-boundaries)


## Overview

This document covers evidence-based coaching methodologies adapted for AI-powered coaching across domains (fitness, education, career, health, customer support). These techniques support behavioral change while respecting the boundaries of AI coaching.

---

## Motivational Interviewing (MI)

### Core Principles (RULE)
- **R**esist the righting reflex - Don't rush to fix or advise
- **U**nderstand the user's motivations - Explore their "why"
- **L**isten with empathy - Reflect and validate
- **E**mpower the user - They have the answers

### The Four Processes

#### 1. Engaging
Build rapport and establish trust.

```python
ENGAGING_PROMPTS = [
    "Tell me a bit about what brought you here today.",
    "What's most important to you about what you're working on?",
    "How has your journey been going so far?",
]
```

#### 2. Focusing
Identify the target behavior or goal.

```python
FOCUSING_PROMPTS = [
    "Of all the things we could work on, what feels most important right now?",
    "If you could change one thing about your situation, what would it be?",
    "What's getting in the way of where you want to be?",
]
```

#### 3. Evoking
Draw out the user's own motivations for change.

```python
EVOKING_PROMPTS = [
    "What would it mean for you to achieve this goal?",
    "How would your life be different if you made this change?",
    "What's worked for you in the past when making changes?",
    "On a scale of 1-10, how important is this change to you? What makes it a {n} and not lower?",
]
```

#### 4. Planning
Support concrete action steps.

```python
PLANNING_PROMPTS = [
    "What's a small first step you could take this week?",
    "What might get in the way, and how could you handle that?",
    "Who could support you in this?",
    "How will you know you're making progress?",
]
```

### OARS Techniques

#### Open-ended Questions
```
Instead of: "Did you practice this week?"
Use: "How did your practice feel this week?"

Instead of: "Do you want to improve?"
Use: "What does progress mean to you?"
```

#### Affirmations
Recognize strengths and efforts.

```python
AFFIRMATION_TEMPLATES = [
    "You've shown real {quality} by {specific_action}.",
    "It takes {quality} to {what_they_did}.",
    "I notice how committed you are to {goal}.",
    "The fact that you're here, having this conversation, shows {positive_trait}.",
]

# Examples:
# "You've shown real determination by tracking your meals every day this week."
# "It takes courage to try something new after a setback."
```

#### Reflections
Mirror back to show understanding.

```python
REFLECTION_TYPES = {
    "simple": "So you're feeling {feeling}.",
    "amplified": "You're saying that {behavior} is completely impossible.",  # Gently exaggerates to prompt correction
    "double_sided": "On one hand {concern}, and on the other hand {motivation}.",
    "meaning": "It sounds like what's really important to you is {underlying_value}.",
}
```

#### Summaries
Collect and reflect key points.

```python
SUMMARY_TEMPLATE = """
Let me make sure I understand what we've talked about.

{key_points}

{transition_statement}

Does that capture it?
"""
```

---

## SMART Goals Framework

### Components
```python
from pydantic import BaseModel, Field

class SMARTGoal(BaseModel):
    """Structured SMART goal representation."""

    specific: str = Field(
        description="What exactly will you do? (action, frequency, context)"
    )
    measurable: str = Field(
        description="How will you track progress? (quantity, frequency, metric)"
    )
    achievable: str = Field(
        description="Is this realistic given current situation? (resources, time, support)"
    )
    relevant: str = Field(
        description="Why does this matter? (connection to values, larger goals)"
    )
    time_bound: str = Field(
        description="By when? (deadline, milestones, check-in points)"
    )

    # Optional additions
    barriers: list[str] = Field(
        default=[],
        description="Anticipated obstacles and how to address them"
    )
    support_needed: str | None = Field(
        default=None,
        description="What help or resources are needed"
    )
```

### Goal-Setting Conversation Flow
```python
SMART_GOAL_PROMPTS = {
    "specific": [
        "Let's get specific - what exactly will this look like day-to-day?",
        "Where and when will you do this?",
        "What does success look like in concrete terms?",
    ],
    "measurable": [
        "How will you know you're making progress?",
        "What numbers or markers will tell you you're on track?",
        "How will you track this?",
    ],
    "achievable": [
        "On a scale of 1-10, how confident are you that you can do this?",
        "What might get in the way?",
        "What would make this feel more doable?",
    ],
    "relevant": [
        "Why is this important to you right now?",
        "How does this connect to your bigger picture goals?",
        "What will achieving this make possible?",
    ],
    "time_bound": [
        "When would you like to achieve this by?",
        "What's a reasonable timeframe?",
        "When should we check in on your progress?",
    ]
}
```

### Goal Refinement Example

This example uses a fitness goal, but the same refinement flow applies to any
domain (study habits, career milestones, customer onboarding, etc.).

```
User: "I want to exercise more."

Coach: "That's a great intention! Let's make it more concrete so we can really track your progress.

When you picture 'exercising more,' what does that actually look like? What type of movement, and how often?"

User: "Maybe walking... like 3 times a week?"

Coach: "Walking is great - it's accessible and easy to build on. Three times a week sounds manageable.

Let me ask: how long would each walk be, and where would you do it?"

User: "Maybe 20 minutes around my neighborhood, probably in the morning before work."

Coach: "Perfect. So here's what I'm hearing:

'Walk for 20 minutes around my neighborhood, 3 mornings per week, before work.'

That's specific, measurable, and time-bound. How confident do you feel, on a scale of 1-10, that you can do this consistently?"
```

---

## Stages of Change (Transtheoretical Model)

### The Five Stages
```python
from enum import Enum

class StageOfChange(Enum):
    PRECONTEMPLATION = "precontemplation"  # Not considering change
    CONTEMPLATION = "contemplation"         # Thinking about change
    PREPARATION = "preparation"             # Getting ready to change
    ACTION = "action"                        # Actively changing
    MAINTENANCE = "maintenance"              # Sustaining change

STAGE_INDICATORS = {
    StageOfChange.PRECONTEMPLATION: [
        "I don't really have a problem",
        "Why does everyone keep bothering me about this",
        "I'm fine the way I am",
    ],
    StageOfChange.CONTEMPLATION: [
        "I've been thinking about...",
        "Part of me wants to...",
        "I know I should but...",
    ],
    StageOfChange.PREPARATION: [
        "I'm ready to...",
        "I've decided to...",
        "I'm planning to start...",
    ],
    StageOfChange.ACTION: [
        "I started...",
        "I've been doing...",
        "This week I...",
    ],
    StageOfChange.MAINTENANCE: [
        "I've been doing this for months",
        "It's become a habit",
        "I don't even think about it anymore",
    ],
}
```

### Stage-Appropriate Coaching
```python
STAGE_STRATEGIES = {
    StageOfChange.PRECONTEMPLATION: {
        "goal": "Raise awareness without pushing",
        "techniques": ["information_sharing", "express_concern", "plant_seeds"],
        "avoid": ["direct_advice", "confrontation", "scare_tactics"],
        "example": "I hear you feel fine as you are. I'm curious - have you noticed any ways this might be affecting other areas of your life?"
    },

    StageOfChange.CONTEMPLATION: {
        "goal": "Explore ambivalence, tip the balance",
        "techniques": ["pros_cons_exploration", "values_clarification", "evoke_change_talk"],
        "avoid": ["rushing_to_action", "dismissing_concerns"],
        "example": "It sounds like you're weighing the options. What would be different if you did make this change?"
    },

    StageOfChange.PREPARATION: {
        "goal": "Support planning, build confidence",
        "techniques": ["goal_setting", "barrier_planning", "small_steps"],
        "avoid": ["overwhelming_with_information", "complex_plans"],
        "example": "You're ready to take action - that's exciting! What's one small first step you could take this week?"
    },

    StageOfChange.ACTION: {
        "goal": "Support implementation, celebrate wins",
        "techniques": ["problem_solving", "celebration", "adjustment"],
        "avoid": ["criticism", "perfectionism"],
        "example": "You're doing the work! What's been going well? And what challenges have you run into?"
    },

    StageOfChange.MAINTENANCE: {
        "goal": "Prevent relapse, reinforce identity",
        "techniques": ["relapse_prevention", "identity_reinforcement", "new_goals"],
        "avoid": ["complacency", "assuming_they_no_longer_need_support"],
        "example": "You've built a real habit here. What situations might be risky for slipping back, and how would you handle them?"
    }
}
```

---

## Behavioral Change Techniques

### Implementation Intentions
"If-then" planning for behavior change.

```python
IMPLEMENTATION_INTENTION_PROMPT = """
Let's make a specific plan for when obstacles come up.

Think about a situation that might get in the way of {goal}.

Now complete this sentence:
"If {obstacle_situation}, then I will {coping_response}."

For example:
"If I feel too tired to walk after work, then I will do a 10-minute walk during my lunch break instead."
"""
```

### Habit Stacking
Attach new habits to existing ones.

```python
HABIT_STACKING_PROMPT = """
One powerful way to build a new habit is to attach it to something you already do consistently.

What's something you do every day without fail? (Examples: brush teeth, morning coffee, commute home)

Now, could we link {new_habit} to that?

For example:
"After I pour my morning coffee, I will write down three things I'm grateful for."
"""
```

### Environment Design
Make good choices easier.

```python
ENVIRONMENT_DESIGN_PROMPTS = [
    "How could you set up your environment to make this easier?",
    "What could you remove from your environment that makes it harder?",
    "Where could you put visual cues to remind you?",
    "What's the path of least resistance right now, and how could we redirect it?",
]
```

---

## Coaching Conversation Structure

### The ARC Model
```
A - Acknowledge: Where they are now
R - Review: What's happened since last time
C - Commit: What's next
```

### Standard Check-in Flow
```python
CHECKIN_STRUCTURE = [
    {
        "phase": "opening",
        "duration": "1-2 minutes",
        "purpose": "Reconnect and set tone",
        "prompts": ["How are you doing today?", "What's been on your mind?"]
    },
    {
        "phase": "review",
        "duration": "3-5 minutes",
        "purpose": "Discuss progress and challenges",
        "prompts": ["How did things go with {last_commitment}?", "What worked well? What was challenging?"]
    },
    {
        "phase": "explore",
        "duration": "5-10 minutes",
        "purpose": "Dig deeper into current focus",
        "prompts": ["Tell me more about...", "What do you think is behind that?"]
    },
    {
        "phase": "commit",
        "duration": "2-3 minutes",
        "purpose": "Establish next steps",
        "prompts": ["What would you like to focus on this week?", "What's one thing you'll commit to?"]
    },
    {
        "phase": "close",
        "duration": "1 minute",
        "purpose": "End positively",
        "prompts": ["I'm excited to hear how it goes.", "You've got this."]
    }
]
```

---

## AI Coaching Boundaries

### What AI Coaching Can Do
- Provide encouragement and accountability
- Ask reflective questions
- Help structure goals
- Offer evidence-based information
- Celebrate progress
- Suggest coping strategies

### What AI Coaching Should NOT Do
- Provide advice outside the system's scope (e.g., medical, legal, or financial advice unless explicitly licensed)
- Diagnose conditions or interpret professional assessments
- Prescribe treatments or other regulated remedies
- Make promises about specific outcomes
- Replace human judgment for complex situations
- Handle crisis situations without human backup

### Escalation Triggers
```python
ESCALATION_TRIGGERS = [
    "User expresses safety concerns",
    "User requests advice outside the system's scope",
    "User shows signs of crisis",
    "User expresses dissatisfaction with AI coaching",
    "Complex situation requiring human judgment",
    "User specifically requests a human",
]
```

---

**Remember**: The best coaching helps people find their own answers. Lead with curiosity, not solutions.
