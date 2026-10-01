# Ecosystem (mirror of the Ecosystem section in `CLAUDE.md`; keep in sync)

- Firmware: sibling repo `../DMX_whIP_embedded` (ESP32 C3/C5/C6/S3, RP2040/RP2350; ArtPollReply, HTTP API, cue bus, DMXREC from SD). Flagship ESP32-P4 + C5 node planned.
- This companion (Windows/Mac/Linux): authoring, recording, monitoring, fixture and layout building, FX and palette building, live control.
- Control tier (planned): Yocto console (CM5, Pi 5, x86), later iPad and Android apps, plus a web remote served by the running host.
- Direction: one headless, Electron-free engine core hosted by the companion, the console and later native shells; one UI bundle; thin platform shells.
- Contracts shared with the firmware are inventoried in `docs/ecosystem/CONTRACTS.md` and will be owned by **whip-spec**. Never change a firmware-shared contract here without flagging it in the PR and updating the firmware consumer, or leave the change unmerged.
