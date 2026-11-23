# Radar Map Manager Lite for Home Assistant

An ESPHome-first, local-only adaptation of [Radar Map Manager](https://github.com/Moe8383/radar_map_manager).

It combines radar targets on an interactive room map and exposes virtual occupancy zones for Home Assistant automations. Use one or multiple radar modules, including HLK-LD6004 devices, if your ESPHome firmware exposes compatible coordinate sensors.

This repository contains **generic examples only**. No user credentials, network endpoints, home-specific entity IDs or device PINs are required.

## Quick install with HACS

1. In Home Assistant open **HACS → ⋮ → Custom repositories**.
2. Paste this repository's URL, choose **Integration**, and add it.
3. Open **Radar Map Manager Lite**, click **Download**, then restart Home Assistant.
4. In **Settings → Devices & services**, add **Radar Map Manager Lite (ESPHome)**.
5. Create a manual Lovelace card:

   ```yaml
   type: custom:radar-map-card
   map_group: default
   title: Room Radar
   ```

### Draw your room before connecting any radar

The **Devices & services** integration page shows the hub and entities, not the map editor. Open the Lovelace card above in a dashboard and click the **🏠 room button** at the top right to open the independent floorplan editor.

1. Enter the room's dimensions in metres (for example, `10 × 4`).
2. Choose **Wall**, **Door** or **Window** and click their start and end points.
3. Choose **Sofa**, **Table**, **Kitchen**, **Chair**, **Bed**, **Cabinet**, **Desk** or **Other** to place furniture.
4. Choose **Select / Move** to reposition objects, or enter their exact coordinates and sizes.
5. Click **Save in Home Assistant**. The floorplan persists locally in the integration's storage and appears beneath radar targets and zones.

The editor also supports snapping to 10 cm, undo, delete, clear, and offline JSON import/export. You can try the [generic 10 × 4 m floorplan](examples/floorplan_10x4.json) by downloading it and using **Import JSON** within the editor. This imports *only the floorplan*; it does not overwrite radar registrations or automation settings. Real-time radar status and people tracking require ESPHome later; drawing does not.

After HACS updates to version **1.4.1**, restart Home Assistant and hard-refresh the dashboard browser to load the updated card. The card reserves 380 px height even in HA section dashboards with no configured radar; this prevents the map from collapsing when leaving dashboard edit mode. A new **update_floorplan** HA action saves the data. This is a 2D plan editor, not an automatic 3D room scan.

**Important:** This fork has the same integration domain as upstream (`radar_map_manager`). Back up your Home Assistant setup, then replace the upstream integration rather than installing both.

## ESPHome firmware for two LD6004 radars

- [Generic ESP32-C3 dual UART configuration](esphome/dual_ld6004_esp32c3.yaml)
- [First flash, pinout and setup guide (Italian)](esphome/LEGGIMI_FIRMWARE.md)

Requires ESPHome 2026.11 beta (or a later stable release with built-in LD6004). All Wi-Fi and encryption credentials stay in the local ESPHome `secrets.yaml` file. GPIOs must be checked against the exact board, and radar modules need a separately rated 3.3 V power supply. **This firmware has not yet been hardware-tested.**

## Sensor requirements

For each radar configured with a prefix such as `room_radar_left`, publish:

```text
sensor.room_radar_left_target_1_x
sensor.room_radar_left_target_1_y
sensor.room_radar_left_target_1_z  # optional: measured height
```

Publish target 2, 3, etc. where supported. Coordinates must be numeric and have the correct unit of measurement (`mm`, `cm`, or `m`). A distance-only entity (`sensor.<prefix>_distance`) supports an approximate 1D display but cannot reliably locate a person within different room zones.

Radar devices are added using the `radar_map_manager.add_radar` HA action with the matching prefix. Layout and virtual zones can be managed in the card or imported from a JSON configuration.

## Generic examples

The [examples](examples) directory includes:

- [Two radar layout for a 10 × 4 m rectangle](examples/dual_radar_room_10x4.json): left, center and right virtual zones. Positions, scale, mounting height and rotations **must be calibrated** for the real installation.
- [Editable 10 × 4 m floorplan](examples/floorplan_10x4.json) for the floorplan editor (no radar required).
- [Occupancy lighting automations](examples/occupancy_lighting.yaml), with placeholder light entities.
- [Optional RGB scenes](examples/rgb_scenes.yaml), never activated automatically.
- [Lovelace card](examples/lovelace_card.yaml).

This is a 2D top-down room view with optional Z/height readings, **not** a fully reconstructed 3D room model.

## Security model

- Radar input comes exclusively from Home Assistant entity states.
- No UDP listener, radar IP connections, MQTT commands, pairing codes or firmware OTA implementation.
- Imported configuration is checked against a restricted set of geometry and software parameters; legacy hardware fields and secrets are dropped.
- One read-only HA WebSocket provides local map updates to authenticated dashboard clients.
- No automatic downloads or external data transmission from this integration.

No static inspection can guarantee that software is free of all bugs. This fork has not yet been validated on real Home Assistant hardware and should not be used as a safety or fall-detection device.

Run offline tests with `python -m unittest discover -s test -v`.

## Documentation and license

- [Guida in italiano](LEGGIMI_LITE.md)
- [MIT License](LICENSE) — original copyright © 2024 Moe8383. Modified fork with attribution.
