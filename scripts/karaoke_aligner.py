import json
import sys


def progress(message):
    print(f"MINT_PROGRESS:{message}", file=sys.stderr, flush=True)


def main():
    request = json.load(sys.stdin)
    audio_path = request.get("audioPath")
    if not isinstance(audio_path, str) or not audio_path:
        raise ValueError("A vocals audio file is required.")

    try:
        from faster_whisper import WhisperModel
    except ImportError as error:
        raise RuntimeError(
            "Karaoke alignment needs faster-whisper. Install it with "
            "\"python -m pip install 'faster-whisper' 'av<19'\", then restart MintPlayer."
        ) from error

    model_name = "small"
    progress(f"Loading faster-whisper {model_name} model (first run downloads the model)...")
    model = WhisperModel(model_name, device="cpu", compute_type="int8")
    lyrics = request.get("lyrics", "")
    has_han = isinstance(lyrics, str) and any("\u3400" <= character <= "\u9fff" for character in lyrics)
    prompt = " ".join(lyrics.split())[:200] if isinstance(lyrics, str) else None
    progress("Transcribing audio and estimating word timings...")
    segments, _ = model.transcribe(
        audio_path,
        language="zh" if has_han else None,
        task="transcribe",
        beam_size=5,
        initial_prompt=prompt,
        word_timestamps=True,
        vad_filter=False,
    )

    words = []
    for segment in segments:
        for word in segment.words or []:
            if word.start is None or word.end is None:
                continue
            text = str(word.word).strip()
            if text:
                words.append({
                    "text": text,
                    "start": float(word.start),
                    "end": float(word.end),
                })

    if not words:
        raise RuntimeError("The speech recognizer did not detect any timed words.")
    json.dump({"words": words}, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr, flush=True)
        sys.exit(1)
