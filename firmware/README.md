# Firmware images

The companion does not compile firmware in-process. The Flash tab **Build firmware** button runs `pio run -e <pioEnv>` in sibling `../DMX_whIP_embedded` (dev checkout only) for the selected catalog board. Identify and flash accept any catalog chip; the port’s chip must match `board.chip`.

Lookup order:

1. `firmware/artifacts/<artifact>/` — `bootloader.bin`, `partitions.bin`, `firmware.bin`
2. Sibling `../DMX_whIP_embedded/.pio/build/<pioEnv>/` (same three files after `pio run -e <pioEnv>`; Matrix is `matrix`, C5 is `c5`)

Do not commit the `.bin` files. After a firmware change, use **Build firmware** (or rebuild `[env:matrix]` in `DMX_whIP_embedded`, or copy those three files into the artifacts folder) before flashing from this app. Copies in `firmware/artifacts/` still win over a fresh PIO build.

Board defaults and flash offsets live in `catalog.json` and must match firmware `BoardProfile`.
