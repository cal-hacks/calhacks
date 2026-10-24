"""Goal-coach tool definitions.

These tools are *executed on the user's device* (that's where goals live until
the SpacetimeDB backend lands), so the server only declares them; the app runs
each tool_use block and sends the tool_result back on the next request.
Keep names and fields in sync with mobile/src/lib/agent.ts.
"""

PERIODS = ["daily", "weekly", "monthly", "yearly"]
CATEGORIES = ["study", "fitness", "wellness", "social", "custom"]
SOURCES = ["location", "calendar", "health", "screenTime", "manual"]

TOOLS = [
    {
        "name": "list_goals",
        "description": (
            "List the user's active goals with their ids, targets, and progress in the current "
            "period. Call this before logging or editing so you use the right goal id, and "
            "whenever the user refers to a goal by a loose name."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
    },
    {
        "name": "create_goal",
        "description": (
            "Create a new goal. Use when the user states something they want to do regularly "
            "(e.g. 'I want to study at the library 2 hours a day'). Pick the period from their "
            "wording; use unit 'minutes' or 'hours' for time, 'times' for counts. Choose track_by "
            "from how it could be measured: 'location' for time at a named place (set place), "
            "'health' for workouts/steps, 'screenTime' for phone use limits (direction 'atMost'), "
            "'calendar' for time in scheduled events, otherwise 'manual'. share_with_friends "
            "defaults to true unless the goal sounds private."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short goal name, e.g. 'Study at the library'"},
                "category": {"type": "string", "enum": CATEGORIES},
                "period": {"type": "string", "enum": PERIODS},
                "target": {"type": "number", "description": "Amount per period, > 0"},
                "unit": {"type": "string", "description": "minutes, hours, times, steps, pages, books, km, miles, ..."},
                "direction": {"type": "string", "enum": ["atLeast", "atMost"]},
                "track_by": {"type": "string", "enum": SOURCES},
                "place": {"type": ["string", "null"], "description": "Place name for location goals, else null"},
                "share_with_friends": {"type": "boolean"},
            },
            "required": [
                "title", "category", "period", "target", "unit",
                "direction", "track_by", "place", "share_with_friends",
            ],
            "additionalProperties": False,
        },
    },
    {
        "name": "log_progress",
        "description": (
            "Record progress toward a goal, e.g. after 'I studied 2 hours at the library' log 120 "
            "to a minutes-based goal (convert to the goal's unit). Use date null for today, or "
            "YYYY-MM-DD for 'yesterday' and other past days. Never log future dates."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "goal_id": {"type": "string"},
                "amount": {"type": "number", "description": "In the goal's unit, > 0"},
                "date": {"type": ["string", "null"], "description": "YYYY-MM-DD, or null for today"},
                "note": {"type": ["string", "null"]},
            },
            "required": ["goal_id", "amount", "date", "note"],
            "additionalProperties": False,
        },
    },
    {
        "name": "update_goal",
        "description": "Change an existing goal. Pass null for every field that should stay the same.",
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {
                "goal_id": {"type": "string"},
                "title": {"type": ["string", "null"]},
                "period": {"anyOf": [{"type": "string", "enum": PERIODS}, {"type": "null"}]},
                "target": {"type": ["number", "null"]},
                "unit": {"type": ["string", "null"]},
                "share_with_friends": {"type": ["boolean", "null"]},
            },
            "required": ["goal_id", "title", "period", "target", "unit", "share_with_friends"],
            "additionalProperties": False,
        },
    },
    {
        "name": "get_progress_summary",
        "description": (
            "Summarize how the user is doing: study hours this month, and for each goal how many "
            "recent periods were met plus the current streak. Use for 'how am I doing?' questions."
        ),
        "strict": True,
        "input_schema": {
            "type": "object",
            "properties": {},
            "required": [],
            "additionalProperties": False,
        },
    },
]
