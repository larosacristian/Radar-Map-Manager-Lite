import logging
import json
import time
from homeassistant.helpers.dispatcher import async_dispatcher_send
from homeassistant.core import HomeAssistant
from .fusion_engine import FusionEngine
_LOGGER = logging.getLogger(__name__)
class RadarProcessor:
    def __init__(self, hass: HomeAssistant, coordinator):
        self.hass = hass
        self._coordinator = coordinator
        self._fusion_engine = FusionEngine(hass, coordinator)
    async def async_start(self):
        _LOGGER.debug("RMM: Processor started.")
    async def async_stop(self):
        _LOGGER.debug("RMM: Processor stopped.")
    async def update(self, now=None, force=False):
        self._fusion_engine.update()
        if self._coordinator:
            self._coordinator._notify_listeners()
        self._update_frontend_sensor()
    def _update_frontend_sensor(self):
        if not self._coordinator.data:
            return
        # Sanitized maps/radars only. This feed is visible to authenticated HA
        # clients, so never add device PINs, credentials, URLs or private metadata.
        data_to_send = {
            "version": self._coordinator.data.get("version", 1),
            "maps": self._coordinator.data.get("maps", {}),
            "radars": self._coordinator.data.get("radars", {}),
        }
        async_dispatcher_send(self.hass, "rmm_stream_update", data_to_send)
