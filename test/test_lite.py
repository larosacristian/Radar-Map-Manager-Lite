"""Self-contained unit tests: run with python -m unittest discover -s test."""
import importlib.util
import json
from pathlib import Path
import sys
import types
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPONENT = ROOT / "custom_components" / "radar_map_manager"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


homeassistant = types.ModuleType("homeassistant")
helpers = types.ModuleType("homeassistant.helpers")
storage = types.ModuleType("homeassistant.helpers.storage")
storage.Store = object
sys.modules.setdefault("homeassistant", homeassistant)
sys.modules.setdefault("homeassistant.helpers", helpers)
sys.modules.setdefault("homeassistant.helpers.storage", storage)
sys.modules.setdefault("custom_components", types.ModuleType("custom_components"))
package = types.ModuleType("custom_components.radar_map_manager")
package.__path__ = [str(COMPONENT)]
sys.modules.setdefault("custom_components.radar_map_manager", package)
load_module("custom_components.radar_map_manager.const", COMPONENT / "const.py")
coordinator_module = load_module(
    "custom_components.radar_map_manager.coordinator", COMPONENT / "coordinator.py"
)
fusion_module = load_module(
    "custom_components.radar_map_manager.fusion_engine", COMPONENT / "fusion_engine.py"
)


class State:
    def __init__(self, value, unit="m"):
        self.state = str(value)
        self.attributes = {"unit_of_measurement": unit}


class States(dict):
    def get(self, key, default=None):
        return super().get(key, default)

    def async_set(self, entity_id, value, attrs):
        self[entity_id] = State(value)
        self[entity_id].attributes.update(attrs)


class LiteTests(unittest.TestCase):
    def test_sanitization_removes_secrets_and_hardware(self):
        source = json.loads((ROOT / "examples" / "dual_radar_room_10x4.json").read_text())
        source["radars"]["room_radar_left"].update({
            "device_pin": "12345678",
            "radar_ip": "ws://example.invalid",
            "auth_passed": True,
            "hw_detect_zones": [{"name": "remote"}],
            "capabilities": {"model": "LD6004"},
        })
        result = coordinator_module.sanitize_config(source)
        dumped = json.dumps(result)
        self.assertNotIn("device_pin", dumped)
        self.assertNotIn("example.invalid", dumped)
        self.assertNotIn("hw_detect_zones", dumped)
        self.assertNotIn("auth_passed", dumped)
        self.assertEqual(len(result["maps"]["default"]["zones"]["include_zones"]), 3)

    def test_two_radars_project_to_opposite_sides(self):
        source = json.loads((ROOT / "examples" / "dual_radar_room_10x4.json").read_text())
        config = coordinator_module.sanitize_config(source)
        states = States({
            "sensor.room_radar_left_target_1_x": State(0),
            "sensor.room_radar_left_target_1_y": State(2.0),
            "sensor.room_radar_right_target_1_x": State(0),
            "sensor.room_radar_right_target_1_y": State(2.0),
        })
        hass = types.SimpleNamespace(states=states)
        coord = types.SimpleNamespace(data=config)
        engine = fusion_module.FusionEngine(hass, coord)
        self.assertEqual(engine._get_radar_point("room_radar_left", 1)["y"], 2000)
        engine.update()
        self.assertAlmostEqual(config["radars"]["room_radar_left"]["targets"][0]["y"], 2000)
        targets = config["maps"]["default"].get("targets", [])
        self.assertGreaterEqual(len(targets), 2)
        x_values = sorted(target["x"] for target in targets)
        self.assertAlmostEqual(x_values[0], 30, delta=2)
        self.assertAlmostEqual(x_values[-1], 70, delta=2)

    def test_unavailable_target_is_not_considered_present(self):
        hass = types.SimpleNamespace(states=States({
            "sensor.radar_target_1_x": State("unavailable"),
            "sensor.radar_target_1_y": State(3),
        }))
        engine = fusion_module.FusionEngine(hass)
        self.assertIsNone(engine._get_radar_point("radar", 1))

    def test_floorplan_roundtrip_without_radar(self):
        source = {
            "maps": {"default": {
                "floorplan": {
                    "width": 10, "height": 4,
                    "items": [
                        {"kind": "wall", "x1": 0, "y1": 0, "x2": 10, "y2": 0},
                        {"kind": "sofa", "x": 0.3, "y": 2.5, "w": 2, "h": 0.9},
                    ]
                }
            }},
            "radars": {},
        }
        safe = coordinator_module.sanitize_config(source)
        self.assertEqual(safe["radars"], {})
        self.assertEqual(safe["maps"]["default"]["floorplan"], source["maps"]["default"]["floorplan"])
        restored = coordinator_module.sanitize_config(json.loads(json.dumps(safe)))
        self.assertEqual(restored, safe)

    def test_floorplan_filters_unsafe_data(self):
        source = {"maps": {"default": {"floorplan": {
            "width": 10, "height": 4, "remote_url": "https://example.invalid/data",
            "items": [
                {"kind": "sofa", "x": 1, "y": 1, "w": 2, "h": 1,
                 "innerHTML": "<script>alert(1)</script>", "name": "secret"},
                {"kind": "iframe", "x": 0, "y": 0, "w": 1, "h": 1},
                {"kind": "wall", "x1": 0, "y1": 0, "x2": 12, "y2": 3},
                {"kind": "chair", "x": 9.7, "y": 3.7, "w": .7, "h": .7},
                {"kind": "door", "x1": 1, "y1": 2, "x2": 2, "y2": 2},
                {"kind": "bed", "x": None, "y": 0, "w": 2, "h": 1},
            ]
        }}}, "radars": {}}
        result = coordinator_module.sanitize_config(source)
        floorplan = result["maps"]["default"]["floorplan"]
        self.assertEqual([item["kind"] for item in floorplan["items"]], ["sofa", "door"])
        self.assertNotIn("example.invalid", json.dumps(result))
        self.assertNotIn("script", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
