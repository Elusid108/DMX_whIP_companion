# Firmware images

The companion does not compile firmware. It flashes a prebuilt ESP32-S3 4MB QSPI image.

Lookup order:

1. `firmware/artifacts/esp32s3-4mb-qspi/` — `bootloader.bin`, `partitions.bin`, `firmware.bin`
2. Sibling `../DMX_whIP_embedded/.pio/build/matrix/` (same three files after `pio run -e matrix`)

Do not commit the `.bin` files. After a firmware change, rebuild `[env:matrix]` in `DMX_whIP_embedded` (or copy those three files into the artifacts folder) before flashing from this app.

Board defaults and flash offsets live in `catalog.json` and must match firmware `BoardProfile`.
