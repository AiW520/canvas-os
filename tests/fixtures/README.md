# Media fixture

`media-pattern.webm` is a 2.2-second, 320 × 180 VP8/WebM recording created by this project's browser regression from a canvas alternating blue and violet with the label “Media regression”. No external footage or audio is included.

The binary is committed because live MediaRecorder capture under headless/background Chrome occasionally produces only an empty WebM header. Tests use the stable recording to verify actual decoding, playback, seeking, preview and offline export.
