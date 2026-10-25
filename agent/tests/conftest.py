import os

# main.py reads settings at import; tests never reach a real database.
os.environ.setdefault("SPACETIMEDB_TOKEN", "test-token")

import pytest

from agent_service import activities

# Fake geocoding for every test, so nothing reaches OpenStreetMap.
CITIES = {
    "new york": (40.7128, -74.0060),
    "brooklyn, ny": (40.6782, -73.9442),
    "austin": (30.2672, -97.7431),
    "austin, tx": (30.2672, -97.7431),
    "round rock, tx": (30.5083, -97.6789),
    "san francisco": (37.7749, -122.4194),
    "palo alto, ca": (37.4419, -122.1430),
    "seattle": (47.6062, -122.3321),
}


@pytest.fixture(autouse=True)
def fake_geocoding(monkeypatch):
    lookups = []

    async def lookup(self, city):
        lookups.append(city)
        return CITIES.get(city)

    monkeypatch.setattr(activities.Geocoder, "_lookup", lookup)
    monkeypatch.setattr(activities, "GEOCODER", activities.Geocoder())
    return lookups
