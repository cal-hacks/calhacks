import os

# main.py reads settings at import; tests never reach a real database.
os.environ.setdefault("SPACETIMEDB_TOKEN", "test-token")
