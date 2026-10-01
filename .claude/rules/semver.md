# Semantic versioning (mirror of `.cursor/rules/semver.mdc`; keep in sync)

After any implementation change in a session, bump `package.json` `version` and the **Version:** line in `README.md`. Window title and UI read `package.json`; do not hardcode the version there.

- **MAJOR**: breaking change (incompatible `.dmx` format, removed UI or protocol behavior)
- **MINOR**: new user-facing capability
- **PATCH**: bug fix, reliability, small internal cleanup, or README checkbox-only progress

One bump per session (highest applicable level). Never skip a bump because the change is small. Checking README boxes with no other code still takes a PATCH.
