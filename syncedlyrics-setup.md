# Synchronized lyrics backup

MintPlayer tries LRCLIB first. If LRCLIB has no usable lyrics after its retries, MintPlayer can use the `syncedlyrics` Python package as a backup. The backup searches Musixmatch, NetEase, and Megalobiz providers; it intentionally skips LRCLIB.

Install Python 3 and the package:

```powershell
py -3 -m pip install -r requirements-lyrics.txt
```

MintPlayer checks the project `.venv` first, then Python available on `PATH`. To use a specific interpreter, set `MINTPLAYER_PYTHON` to its full path before launching MintPlayer.

Packaged builds do not bundle Python or the Python package. The backup requires a separate Python installation with `syncedlyrics` installed. If it is unavailable, LRCLIB search still works and MintPlayer reports that the backup could not run.
