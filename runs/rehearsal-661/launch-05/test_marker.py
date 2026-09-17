import json
from pathlib import Path


def test_marker_content():
    marker_path = Path(__file__).with_name("marker.json")

    assert json.loads(marker_path.read_text()) == {"launch": 5}
