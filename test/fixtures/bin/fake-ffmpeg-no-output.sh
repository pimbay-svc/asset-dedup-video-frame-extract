#!/usr/bin/env bash
# Test double for ffmpeg: exits 0 (success) without ever writing the
# requested output file, to deterministically exercise VideoProvider's
# "output file missing despite a clean exit" CorruptInputError branch —
# a case real ffmpeg practically never produces on demand.
exit 0
