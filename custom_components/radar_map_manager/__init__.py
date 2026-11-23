"""Radar Map Manager Lite: local ESPHome entity reader, with no device networking.

This fork does not open UDP listeners, subscribe to MQTT, connect to radar IPs,
handle PINs, pair devices or send firmware update commands.
"""

from __future__ import annotations

import json
import logging
import os
from datetime import timedelta

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.dispatcher import async_dispatcher_connect
from homeassistant.helpers.event import async_track_time_interval

from .const import DOMAIN
from .coordinator import RadarCoordinator, sanitize_config
from .processor import RadarProcessor

_LOGGER = logging.getLogger(__name__)
PLATFORMS = ["sensor", "binary_sensor"]
NAME = vol.Match(r"^[a-z0-9_]{1,64}$")
ZONE_TYPES = ("include_zones", "exclude_zones", "entrance_zones", "stationary_zones", "monitor_zones")

ADD_RADAR_SCHEMA = vol.Schema({
    vol.Required("radar_name"): NAME,
    vol.Optional("map_group", default="default"): NAME,
})
REMOVE_RADAR_SCHEMA = vol.Schema({vol.Required("radar_name"): NAME})
SET_RADAR_PAUSE_SCHEMA = vol.Schema({
    vol.Required("radar_name"): NAME, vol.Required("paused"): cv.boolean,
})
UPDATE_ZONE_SCHEMA = vol.Schema({
    vol.Optional("radar_name"): vol.Any(NAME, None),
    vol.Required("zone_type"): vol.In(ZONE_TYPES),
    vol.Required("points"): list,
    vol.Optional("delay", default=0): vol.Coerce(float),
    vol.Optional("name", default="Zone"): cv.string,
    vol.Optional("map_group", default="default"): NAME,
})
UPDATE_LAYOUT_SCHEMA = vol.Schema({
    vol.Required("radar_name"): NAME,
    vol.Required("layout"): dict,
    vol.Optional("map_group"): NAME,
    vol.Optional("zones"): dict,
})
UPDATE_MAP_CONFIG_SCHEMA = vol.Schema(
    {vol.Required("map_group"): NAME}, extra=vol.ALLOW_EXTRA
)
UPDATE_FLOORPLAN_SCHEMA = vol.Schema({
    vol.Required("map_group"): NAME,
    vol.Required("floorplan"): dict,
})
IMPORT_SCHEMA = vol.Schema({
    vol.Required("config_json"): cv.string,
    vol.Optional("map_group", default="default"): NAME,
}, extra=vol.ALLOW_EXTRA)


async def async_setup(hass: HomeAssistant, config: dict) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await _register_frontend(hass)
    if not hass.data[DOMAIN].get("stream_registered"):
        websocket_api.async_register_command(hass, websocket_global_stream)
        hass.data[DOMAIN]["stream_registered"] = True
    return True


@websocket_api.websocket_command({vol.Required("type"): "rmm/stream"})
@callback
def websocket_global_stream(hass, connection, msg):
    """Local HA websocket only; no outgoing websocket to any device."""

    @callback
    def send_update(data):
        connection.send_message(websocket_api.event_message(msg["id"], {"data": data}))

    unsub = async_dispatcher_connect(hass, "rmm_stream_update", send_update)
    connection.subscriptions[msg["id"]] = unsub
    connection.send_result(msg["id"])
    coordinator = hass.data.get(DOMAIN, {}).get("coordinator")
    if coordinator:
        send_update({
            "version": coordinator.data.get("version", 1),
            "maps": coordinator.data.get("maps", {}),
            "radars": coordinator.data.get("radars", {}),
        })


async def _register_frontend(hass: HomeAssistant) -> None:
    domain_data = hass.data.setdefault(DOMAIN, {})
    if domain_data.get("frontend_registered"):
        return
    www_path = os.path.join(os.path.dirname(__file__), "www")
    await hass.http.async_register_static_paths(
        [StaticPathConfig("/radar_map_manager", www_path, cache_headers=False)]
    )
    add_extra_js_url(hass, "/radar_map_manager/radar-map-card.js?v=lite-3")
    domain_data["frontend_registered"] = True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    await _register_frontend(hass)
    coordinator = RadarCoordinator(hass)
    await coordinator.async_load()
    processor = RadarProcessor(hass, coordinator)
    hass.data[DOMAIN].update({"coordinator": coordinator, "processor": processor})

    async def refresh(_now=None):
        await processor.update()

    async def handle_add_radar(call: ServiceCall):
        name = call.data["radar_name"]
        # ESPHome must expose sensor.<name>_target_1_x/_y (or <name>_distance).
        await coordinator.async_add_radar(name, call.data["map_group"])
        await processor.update(force=True)

    async def handle_remove_radar(call: ServiceCall):
        await coordinator.async_remove_radar(call.data["radar_name"])
        await processor.update(force=True)

    async def handle_pause(call: ServiceCall):
        await coordinator.async_set_radar_pause(call.data["radar_name"], call.data["paused"])
        await processor.update(force=True)

    async def handle_zone(call: ServiceCall):
        zone_type = call.data["zone_type"]
        radar_name = call.data.get("radar_name")
        if radar_name and zone_type != "monitor_zones":
            raise vol.Invalid("Only monitor_zones can be assigned to a radar")
        if not radar_name and zone_type == "monitor_zones":
            raise vol.Invalid("monitor_zones requires radar_name")
        points = call.data["points"]
        if points and isinstance(points[0], dict):
            zones = points
        else:
            zones = [{"name": call.data["name"], "delay": call.data["delay"], "points": points}]
        clean = sanitize_config({"maps": {
            "default": {"zones": {zone_type: zones}, "config": {}}
        }, "radars": {}})
        clean_zones = clean["maps"]["default"]["zones"].get(zone_type, [])
        if radar_name:
            await coordinator.async_update_zone(
                radar_name, zone_type, clean_zones, call.data.get("map_group")
            )
        else:
            await coordinator.async_update_zone(
                None, zone_type, clean_zones, call.data.get("map_group")
            )
        await processor.update(force=True)

    async def handle_layout(call: ServiceCall):
        name = call.data["radar_name"]
        if name not in coordinator.data["radars"]:
            raise vol.Invalid("Unknown radar")
        clean = sanitize_config({"maps": {}, "radars": {name: {
            "layout": call.data["layout"],
            "monitor_zones": call.data.get("zones", {}).get("monitor_zones", []),
        }}})
        cfg = clean["radars"][name]
        supplied_zones = call.data.get("zones", {})
        safe_monitor = (
            {"monitor_zones": cfg["monitor_zones"]}
            if isinstance(supplied_zones, dict) and "monitor_zones" in supplied_zones
            else None
        )
        await coordinator.async_update_layout(
            name, cfg["layout"], call.data.get("map_group"),
            zones=safe_monitor,
        )
        await processor.update(force=True)

    async def handle_map_config(call: ServiceCall):
        map_group = call.data["map_group"]
        clean = sanitize_config({"maps": {
            map_group: {"zones": {}, "config": dict(call.data)}
        }, "radars": {}})
        config_data = clean["maps"][map_group]["config"]
        await coordinator.async_update_map_config(map_group, config_data)
        await processor.update(force=True)

    async def handle_floorplan(call: ServiceCall):
        try:
            await coordinator.async_update_floorplan(
                call.data["map_group"], call.data["floorplan"]
            )
        except ValueError as exc:
            raise vol.Invalid(str(exc)) from exc
        await processor.update(force=True)

    async def handle_import(call: ServiceCall):
        raw = call.data["config_json"]
        if len(raw) > 200_000:
            raise vol.Invalid("Configuration exceeds 200 KB")
        try:
            parsed = json.loads(raw)
        except (ValueError, TypeError) as exc:
            raise vol.Invalid("Invalid JSON") from exc
        if not isinstance(parsed, dict):
            raise vol.Invalid("Configuration must be a JSON object")
        if "maps" in parsed or "radars" in parsed:
            # Full backup, clean *all* old PINs, device URLs and hardware controls.
            coordinator.data = sanitize_config(parsed)
        else:
            # Old single-map backups: retain only map zones and software settings.
            map_id = call.data["map_group"]
            candidate = {"maps": {map_id: {
                "zones": parsed.get("global_zones", {}),
                "config": parsed.get("global_config", {}),
            }}, "radars": {}}
            clean = sanitize_config(candidate)
            coordinator.data["maps"][map_id] = clean["maps"][map_id]
        await coordinator.async_save()
        await processor.update(force=True)

    async def handle_reset(_call: ServiceCall):
        coordinator.data["_force_reset_history"] = True
        await processor.update(force=True)

    async def handle_generate(_call: ServiceCall):
        await processor.update(force=True)

    handlers = {
        "add_radar": (handle_add_radar, ADD_RADAR_SCHEMA),
        "remove_radar": (handle_remove_radar, REMOVE_RADAR_SCHEMA),
        "set_radar_pause": (handle_pause, SET_RADAR_PAUSE_SCHEMA),
        "update_radar_zone": (handle_zone, UPDATE_ZONE_SCHEMA),
        "update_radar_layout": (handle_layout, UPDATE_LAYOUT_SCHEMA),
        "update_map_config": (handle_map_config, UPDATE_MAP_CONFIG_SCHEMA),
        "update_floorplan": (handle_floorplan, UPDATE_FLOORPLAN_SCHEMA),
        "import_config": (handle_import, IMPORT_SCHEMA),
        "reset_tracking_history": (handle_reset, vol.Schema({})),
        "generate_radar_config": (handle_generate, vol.Schema({})),
    }
    for name, (handler, schema) in handlers.items():
        hass.services.async_register(DOMAIN, name, handler, schema=schema)

    hass.data[DOMAIN]["service_names"] = tuple(handlers)
    # The one read-only HA websocket is registered once in async_setup.
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    hass.data[DOMAIN]["timer_remove"] = async_track_time_interval(
        hass, refresh, timedelta(seconds=0.5)
    )
    await processor.update(force=True)
    _LOGGER.info("Radar Map Manager Lite started (ESPHome entities only)")
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    domain_data = hass.data.get(DOMAIN, {})
    stop = domain_data.pop("timer_remove", None)
    if stop:
        stop()
    ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if ok:
        for name in domain_data.get("service_names", ()):
            hass.services.async_remove(DOMAIN, name)
        domain_data.pop("coordinator", None)
        domain_data.pop("processor", None)
    return ok
