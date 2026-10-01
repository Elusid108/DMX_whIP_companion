# Firmware compatibility (mirror of `.cursor/rules/firmware-compat.mdc`; keep in sync)

Sibling firmware repo: `../DMX_whIP_embedded`. Contract owners:
- HTTP, `/status`, 503/live/park: firmware README **Companion PC** block
- `DMXREC` `.dmx`: sibling `include/dmxrec.h` and `src/services/shared/dmxRecording.js`
- ArtPoll pairing: firmware `artnet_rx.cpp` and `whipRejectReason()` in `src/main/ipc/network.js`
- Board defaults / flash artifacts: `firmware/catalog.json` must match firmware `BoardProfile`

`/status` extra keys are additive; ignore unknowns; do not scrape portal HTML. `MIN_FIRMWARE_API` in `src/services/shared/firmwareCompat.js` is the floor; missing `api` is `0`. A breaking wire change bumps firmware `kFirmwareApi`, firmware MAJOR and this app together. Update the firmware consumer in the sibling repo or leave the change unmerged.
