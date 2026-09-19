# Firmware images

The companion does not compile firmware in-process. The Flash tab **Build firmware** button runs `pio run -e matrix` in sibling `../DMX_whIP_embedded` (dev checkout only). It then flashes a prebuilt ESP32-S3 4MB QSPI image.

Lookup order:

1. `firmware/artifacts/esp32s3-4mb-qspi/` — `bootloader.bin`, `partitions.bin`, `firmware.bin`
2. Sibling `../DMX_whIP_embedded/.pio/build/matrix/` (same three files after `pio run -e matrix`)

Do not commit the `.bin` files. After a firmware change, use **Build firmware** (or rebuild `[env:matrix]` in `DMX_whIP_embedded`, or copy those three files into the artifacts folder) before flashing from this app. Copies in `firmware/artifacts/` still win over a fresh PIO build.

Board defaults and flash offsets live in `catalog.json` and must match firmware `BoardProfile`.
