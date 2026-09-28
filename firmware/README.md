# Firmware images

The companion does not compile firmware in-process. The Flash tab **Build firmware** button runs `pio run -e <pioEnv>` in sibling `../DMX_whIP_embedded` (dev checkout only) for the selected catalog board. Identify and flash accept any catalog chip; the port’s chip must match `board.chip`.

Lookup order:

1. `firmware/artifacts/<artifact>/` — `bootloader.bin`, `partitions.bin`, `firmware.bin`
2. Sibling `../DMX_whIP_embedded/.pio/build/<pioEnv>/` (same three files after `pio run -e <pioEnv>`; Matrix is `matrix`, C5 DevKit is `c5`, XIAO C5 / S3 / C3 / C6 are `xiao-c5` / `xiao-s3` / `xiao-c3` / `xiao-c6`)

Do not commit the `.bin` files. After a firmware change, use **Build firmware** (or rebuild `[env:matrix]` in `DMX_whIP_embedded`, or copy those three files into the artifacts folder) before flashing from this app. Copies in `firmware/artifacts/` still win over a fresh PIO build.

Board defaults and flash offsets live in `catalog.json` and must match firmware `BoardProfile`.
Each board also carries `family` (esp / rp), `gpio` ({ max, reserved, strapping }: what the Flash tab lets you pick and warns about), `silk` (XIAO label to GPIO; every XIAO is wired D0 data, D1 clock, D7–D10 SD CS/SCK/MISO/MOSI), `detect` (USB ids + flash size for auto-detect), `wifi5g` and `brightnessWarn` (0 = no overheat warning).
The `flash` mode / freq / size fields describe the build; the Flash tab writes every image with its header unchanged (`keep`), because esptool-js rewrites the flash-frequency byte from one table for all chips and that table is wrong for the ESP32-C6.
