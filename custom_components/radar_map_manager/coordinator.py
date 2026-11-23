import logging
import math
import re
import traceback
from homeassistant.helpers.storage import Store
from .const import DOMAIN
_LOGGER = logging.getLogger(__name__)
STORAGE_VERSION = 1
STORAGE_KEY = DOMAIN
DATA_VERSION = 1

# Only the geometry and non-sensitive display/tracking settings survive import
# or migration from the original integration. Legacy PINs and IPs are discarded.
VALID_ID = re.compile(r"^[a-z0-9_]{1,64}$")
ZONE_KEYS = frozenset(("include_zones", "exclude_zones", "entrance_zones",
                       "stationary_zones", "monitor_zones"))
LAYOUT_KEYS = frozenset((
    "origin_x", "origin_y", "scale_x", "scale_y", "rotation",
    "mount_height", "target_height", "radar_type", "ceiling_mount",
    "mirror_x", "enable_correction", "z_min", "z_max", "fov",
    "fov_angle", "max_distance", "radar_max_distance", "fov_width",
))
CONFIG_KEYS = frozenset((
    "update_interval", "merge_distance", "target_height", "fused_color",
    "ema_smoothing_level", "verify_delay", "hibernation_ttl",
    "enable_verify_rule", "enable_tracking", "show_labels", "show_trails",
    "max_jump_base", "max_jump_speed", "stationary_max_hold",
    "map_scale_x", "map_scale_y", "panel_opacity", "target_render_mode",
    "fall_alert_enabled", "fall_threshold_h", "fall_duration",
    "show_pointcloud", "show_radar_fov", "show_radar_labels",
    "show_coordinates", "show_grid", "grid_size",
))
FLOORPLAN_SEGMENTS = frozenset(("wall", "door", "window"))
FLOORPLAN_FURNITURE = frozenset((
    "sofa", "table", "kitchen", "chair", "bed", "cabinet", "desk", "other",
))
MAX_FLOORPLAN_ITEMS = 120


def _safe_number(value, lo=-10000.0, hi=10000.0):
    if isinstance(value, bool):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError, OverflowError):
        return None
    return result if math.isfinite(result) and lo <= result <= hi else None


def _safe_text(value, fallback="Zone"):
    if not isinstance(value, str):
        return fallback
    # Labels are used in HTML fragments by the original UI.
    result = "".join(c for c in value[:64] if c.isalnum() or c in " _-.")
    return result.strip() or fallback


def _safe_zones(value):
    if not isinstance(value, list):
        return []
    clean = []
    for zone in value[:64]:
        if isinstance(zone, dict):
            points = zone.get("points", [])
            name = _safe_text(zone.get("name", "Zone"))
            delay = _safe_number(zone.get("delay", 0), 0, 3600)
        else:
            points, name, delay = zone, "Zone", 0
        if not isinstance(points, list):
            continue
        polygon = []
        for point in points[:64]:
            if isinstance(point, (list, tuple)) and len(point) >= 2:
                x, y = point[:2]
            elif isinstance(point, dict):
                x, y = point.get("x"), point.get("y")
            else:
                continue
            x, y = _safe_number(x, -100, 200), _safe_number(y, -100, 200)
            if x is not None and y is not None:
                polygon.append([x, y])
        if len(polygon) >= 3:
            clean.append({"name": name, "delay": delay or 0, "points": polygon})
    return clean


def _safe_floorplan(value):
    """Only bounded room geometry survives storage and imports. Never URLs/HTML."""
    if not isinstance(value, dict):
        return None
    width = _safe_number(value.get("width"), 1, 100)
    height = _safe_number(value.get("height"), 1, 100)
    if width is None or height is None:
        return None
    items = value.get("items", [])
    if not isinstance(items, list):
        return None
    clean_items = []
    for item in items[:MAX_FLOORPLAN_ITEMS]:
        if not isinstance(item, dict):
            continue
        kind = item.get("kind")
        if kind in FLOORPLAN_SEGMENTS:
            x1 = _safe_number(item.get("x1"), 0, width)
            y1 = _safe_number(item.get("y1"), 0, height)
            x2 = _safe_number(item.get("x2"), 0, width)
            y2 = _safe_number(item.get("y2"), 0, height)
            if None in (x1, y1, x2, y2):
                continue
            if math.hypot(x2 - x1, y2 - y1) < 0.05:
                continue
            clean_items.append({"kind": kind, "x1": x1, "y1": y1,
                                "x2": x2, "y2": y2})
        elif kind in FLOORPLAN_FURNITURE:
            x = _safe_number(item.get("x"), 0, width)
            y = _safe_number(item.get("y"), 0, height)
            w = _safe_number(item.get("w"), 0.1, width)
            h = _safe_number(item.get("h"), 0.1, height)
            if None in (x, y, w, h) or x + w > width + 0.001 or y + h > height + 0.001:
                continue
            clean_items.append({"kind": kind, "x": x, "y": y,
                                "w": w, "h": h})
    return {"width": width, "height": height, "items": clean_items}


def sanitize_config(candidate):
    """Validate imported/stored geometry and drop all unknown fields."""
    candidate = candidate if isinstance(candidate, dict) else {}
    maps = {}
    raw_maps = candidate.get("maps", {})
    if isinstance(raw_maps, dict):
        for name, group in list(raw_maps.items())[:16]:
            if not isinstance(name, str) or not VALID_ID.fullmatch(name) or not isinstance(group, dict):
                continue
            zones = group.get("zones", {})
            zones = zones if isinstance(zones, dict) else {}
            cfg = group.get("config", {})
            cfg = cfg if isinstance(cfg, dict) else {}
            safe_cfg = {}
            for key, value in cfg.items():
                if key not in CONFIG_KEYS:
                    continue
                if isinstance(value, bool):
                    safe_cfg[key] = value
                elif isinstance(value, str) and key in ("fused_color", "target_render_mode"):
                    if key == "fused_color" and re.fullmatch(r"#[0-9a-fA-F]{6}", value):
                        safe_cfg[key] = value
                    elif key == "target_render_mode" and value in ("css", "canvas"):
                        safe_cfg[key] = value
                elif (number := _safe_number(value)) is not None:
                    safe_cfg[key] = number
            maps[name] = {
                "zones": {k: _safe_zones(v) for k, v in zones.items() if k in ZONE_KEYS},
                "config": safe_cfg,
            }
            floorplan = _safe_floorplan(group.get("floorplan"))
            if floorplan is not None:
                maps[name]["floorplan"] = floorplan
    if "default" not in maps:
        maps["default"] = {"zones": {}, "config": {}}
    radars = {}
    raw_radars = candidate.get("radars", {})
    if isinstance(raw_radars, dict):
        for name, radar in list(raw_radars.items())[:32]:
            if not isinstance(name, str) or not VALID_ID.fullmatch(name) or not isinstance(radar, dict):
                continue
            layout = radar.get("layout", {})
            layout = layout if isinstance(layout, dict) else {}
            clean_layout = {}
            for key, val in layout.items():
                if key not in LAYOUT_KEYS:
                    continue
                if key in ("ceiling_mount", "mirror_x", "enable_correction"):
                    if isinstance(val, bool):
                        clean_layout[key] = val
                elif (num := _safe_number(val)) is not None:
                    clean_layout[key] = num
            group = radar.get("map_group", "default")
            if not isinstance(group, str) or group not in maps:
                group = "default"
            radars[name] = {
                "map_group": group,
                "paused": radar.get("paused", False) is True,
                "layout": clean_layout,
                "monitor_zones": _safe_zones(radar.get("monitor_zones", [])),
            }
    return {"version": DATA_VERSION, "maps": maps, "radars": radars}
class RadarCoordinator:
    def __init__(self, hass):
        self.hass = hass
        self._store = Store(hass, STORAGE_VERSION, STORAGE_KEY)
        self.data = self._get_empty_data()
        self._listeners = []
        self.last_update_success = True 
        self.name = "RadarMapManager Coordinator"
    def _get_empty_data(self):
        return {
            "version": DATA_VERSION,
            "maps": {
                "default": {
                    "zones": {"include_zones": [], "exclude_zones": [], "entrance_zones": [], "stationary_zones": []},
                    "config": {
                        "update_interval": 0.1, 
                        "merge_distance": 0.8,
                        "target_height": 1.5,
                        "fused_color": "#FFD700",
                        "ema_smoothing_level": 7,
                        "verify_delay": 2.5,
                        "hibernation_ttl": 12.0,
                        "enable_verify_rule": True,
                        "enable_tracking": True,
                        "show_labels": False,
                        "show_trails": True,
                        "max_jump_base": 1.0,
                        "max_jump_speed": 2.5,
                        "stationary_max_hold": 300.0
                    }
                }
            },
            "radars": {}
        }
    def async_add_listener(self, callback, context=None):
        self._listeners.append(callback)
        def unsubscribe():
            if callback in self._listeners:
                self._listeners.remove(callback)
        return unsubscribe
    def _notify_listeners(self):
        for callback in self._listeners:
            try:
                callback()
            except Exception as e:
                _LOGGER.error(f"RMM: Error in update listener: {e}\n{traceback.format_exc()}")
    async def async_load(self):
        try:
            raw_data = await self._store.async_load()
        except Exception as e:
            _LOGGER.error(f"RMM: Storage load error: {e}. Resetting.")
            raw_data = None
        if raw_data is None or not isinstance(raw_data, dict):
            _LOGGER.info("RMM: Initializing fresh data.")
            self.data = self._get_empty_data()
            await self.async_save()
            return
        self.data = sanitize_config(raw_data)
        if "maps" not in self.data: self.data["maps"] = {}
        if "default" not in self.data["maps"]:
            self.data["maps"]["default"] = {"zones": {"include_zones": [], "exclude_zones": []}, "config": {}}
        if "radars" not in self.data: self.data["radars"] = {}
        if "global_config" in self.data:
            old_global = self.data.pop("global_config")
            for m_id, m_data in self.data["maps"].items():
                if "config" not in m_data: m_data["config"] = old_global.copy()
        default_cfg = self._get_empty_data()["maps"]["default"]["config"]
        for m_id, m_data in self.data["maps"].items():
            if "config" not in m_data: m_data["config"] = default_cfg.copy()
            if "fused_color" not in m_data["config"]: m_data["config"]["fused_color"] = "#FFD700"
        _LOGGER.info(f"RMM: Data loaded (V{self.data.get('version', 1)}).")
    async def async_save(self):
        await self._store.async_save(self.data)
        self._notify_listeners()
    async def async_add_radar(self, name, map_group="default"):
        if name in self.data["radars"]: return
        self.data["radars"][name] = {
            "map_group": map_group,
            "paused": False,
            "layout": {"origin_x": 50, "origin_y": 50, "scale_x": 5, "scale_y": 5, "rotation": 0},
            "monitor_zones": []
        }
        if map_group not in self.data["maps"]:
            self.data["maps"][map_group] = {"zones": {"include_zones": [], "exclude_zones": []}, "config": self._get_empty_data()["maps"]["default"]["config"].copy()}
        await self.async_save()
    async def async_set_radar_pause(self, radar_name, paused):
        if radar_name in self.data["radars"]:
            self.data["radars"][radar_name]["paused"] = bool(paused)
            await self.async_save()
    async def async_remove_radar(self, name):
        if name in self.data["radars"]:
            del self.data["radars"][name]
            await self.async_save()
    async def async_update_zone(self, radar_name, zone_type, points, map_group="default"):
        if radar_name and radar_name in self.data["radars"]:
            if zone_type in ["monitor_zones", "hw_detect_zones", "hw_block_zones", "hw_stay_zones"]:
                self.data["radars"][radar_name][zone_type] = points
                await self.async_save()
                return
        target_map = map_group or "default"
        if target_map not in self.data["maps"]:
            self.data["maps"][target_map] = {"zones": {"include_zones": [], "exclude_zones": []}}
        if zone_type in ["include_zones", "exclude_zones", "entrance_zones", "stationary_zones"]:
            self.data["maps"][target_map]["zones"][zone_type] = points
            await self.async_save()
    async def async_update_layout(self, radar_name, layout, map_group=None, zones=None):
        if radar_name in self.data["radars"]:
            current = self.data["radars"][radar_name].get("layout", {})
            current.update(layout)
            self.data["radars"][radar_name]["layout"] = current
            if map_group:
                self.data["radars"][radar_name]["map_group"] = map_group
                if map_group not in self.data["maps"]:
                    self.data["maps"][map_group] = {"zones": {"include_zones": [], "exclude_zones": []}}
            if zones and isinstance(zones, dict):
                for z_type, z_pts in zones.items():
                    if z_type in ["hw_detect_zones", "hw_block_zones", "hw_stay_zones", "monitor_zones"]:
                        self.data["radars"][radar_name][z_type] = z_pts
            await self.async_save()
    async def async_update_map_config(self, map_group, config_data):
        if map_group not in self.data["maps"]:
            self.data["maps"][map_group] = {"zones": {}, "config": {}}
        if "config" not in self.data["maps"][map_group]:
            self.data["maps"][map_group]["config"] = {}
        safe_data = {k: v for k, v in config_data.items() if k != "map_group"}
        self.data["maps"][map_group]["config"].update(safe_data)
        await self.async_save()

    async def async_update_floorplan(self, map_group, floorplan):
        safe = _safe_floorplan(floorplan)
        if safe is None:
            raise ValueError("Invalid room geometry")
        if map_group not in self.data["maps"]:
            self.data["maps"][map_group] = {"zones": {}, "config": {}}
        self.data["maps"][map_group]["floorplan"] = safe
        await self.async_save()
