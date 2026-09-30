# Firmware images

The companion does not compile firmware in-process. The Flash tab **Build all** button runs `python scripts/release.py` in sibling `../DMX_whIP_embedded` (dev checkout only): it builds every release board at one version and writes a release bundle to `DMX_whIP_embedded/dist/whip-<ver>/`. Identify and flash accept any catalog chip; the port’s chip must match `board.chip`.

## Where images come from

USB flash and OTA use the same lookup (`src/main/firmwareImages.js`). Every source below is a candidate for a board; the **highest `WHIPFW:` version wins**, and a tie goes to the newer file (so a fresh single-board `pio run` beats a bundle of the same version):

1. `firmware/releases/<name>/manifest.json` — release bundles shipped with the app (copy a `dist/whip-<ver>/` folder or unzip `whip-<ver>.zip` here)
2. Sibling `../DMX_whIP_embedded/dist/<name>/manifest.json` — bundles from **Build all** / `scripts/release.py`
3. `firmware/artifacts/<artifact>/` — loose `bootloader.bin`, `partitions.bin`, `firmware.bin`
4. Sibling `../DMX_whIP_embedded/.pio/build/<pioEnv>/` — the last `pio run -e <pioEnv>` (Matrix `matrix`, C5 DevKit `c5`, XIAO C5 / S3 / C3 / C6 `xiao-c5` / `xiao-s3` / `xiao-c3` / `xiao-c6`)

A bundle's `manifest.json` (schema 1, `src/services/shared/firmwareManifest.js`) gives each board's files, flash offsets, NVS / otadata layout and sha256; the app refuses a file whose sha256 does not match. Loose images (3, 4) use the catalog's `flash` offsets. Images without a `WHIPFW:` tag (pre-OTA firmware) can still be flashed over USB but are not offered for OTA.

An RP2040 / RP2350 board (`family: rp`) has one file, `firmware.uf2`: in a bundle the manifest's `uf2` entry (file, UF2 family id, size, sha256, tag); loose, `firmware.uf2` with `firmware.bin` beside it (the tag is read from the `.bin`, since inside a UF2 it can straddle two blocks). RP boards have no radio, so they are never offered for OTA.

Do not commit `.bin` / `.uf2` files or bundles.

## RP2040 / RP2350 over USB

`src/main/uf2Flash.js`. The running firmware is sent `whip boot` (firmware 0.56+; older firmware gets the 1200-baud touch), the bootloader's drive appears, `INFO_UF2.TXT` in its root names the chip (`Board-ID: RPI-RP2` or `RP2350`, catalog `detect.uf2Board`), and the UF2 is copied onto it. The board restarts by itself. Settings then go over serial (`whip set`, `whip pmap`, firmware `serial_cmd`). A drive cannot be matched to the port it came from, so that stretch runs for one board at a time; several RP boards still flash in one run, one after another. A board that is already in its bootloader (blank, or **B** held while plugging in) has no serial port and is listed as a `UF2 <drive>` row.

## catalog.json

Board defaults and fallback flash offsets live in `catalog.json` and must match firmware `BoardProfile`.
Each board also carries `family` (esp / rp), `gpio` ({ max, reserved, strapping }: what the Flash tab lets you pick and warns about), `silk` (XIAO label to GPIO; every XIAO is wired D0 data, D1 clock, D7–D10 SD CS/SCK/MISO/MOSI), `detect` (USB ids + flash size for auto-detect; `uf2Board` for an RP bootloader drive), `sdSpi` (RP boards: the GPIOs the SD card's SPI bus can use for CLK / MOSI / MISO; the firmware refuses any other), `net` (false = no radio), `wifi5g` and `brightnessWarn` (0 = no overheat warning).
The `flash` mode / freq / size fields describe the build; the Flash tab writes every image with its header unchanged (`keep`), because esptool-js rewrites the flash-frequency byte from one table for all chips and that table is wrong for the ESP32-C6. Flashing passes the port's real USB vendor / product id to esptool-js, so native-USB boards (PID 0x1001) get the USB-Serial/JTAG reset sequence.
