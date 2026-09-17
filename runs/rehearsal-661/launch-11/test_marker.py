import json
from pathlib import Path


marker_path = Path(__file__).with_name("marker.json")
assert json.loads(marker_path.read_text(encoding="utf-8")) == {"launch": 11}
