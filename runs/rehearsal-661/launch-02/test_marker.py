import json
from pathlib import Path
import unittest


class MarkerTest(unittest.TestCase):
    def test_marker_content(self):
        marker_path = Path(__file__).with_name("marker.json")
        self.assertEqual(json.loads(marker_path.read_text()), {"launch": 2})


if __name__ == "__main__":
    unittest.main()
