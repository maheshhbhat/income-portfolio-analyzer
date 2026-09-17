import json
from pathlib import Path


def test_marker_content():
    marker_path = Path(__file__).with_name("marker.json")

    with marker_path.open(encoding="utf-8") as marker_file:
        assert json.load(marker_file) == {"launch": 9}
