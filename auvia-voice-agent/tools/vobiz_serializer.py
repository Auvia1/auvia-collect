# tools/vobiz_serializer.py
import base64
import json
from loguru import logger

from pipecat.audio.utils import create_stream_resampler, pcm_to_ulaw, ulaw_to_pcm
from pipecat.frames.frames import (
    AudioRawFrame,
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    StartFrame,
)
from pipecat.serializers.base_serializer import FrameSerializer

VOBIZ_SAMPLE_RATE = 8000

class VobizFrameSerializer(FrameSerializer):
    """Serializer for Vobiz WebSocket audio streaming protocol."""

    class InputParams(FrameSerializer.InputParams):
        vobiz_sample_rate: int = VOBIZ_SAMPLE_RATE
        sample_rate: int | None = None

    def __init__(self, params: InputParams | None = None):
        params = params or VobizFrameSerializer.InputParams()
        super().__init__(params)
        self._params: VobizFrameSerializer.InputParams = params
        self._vobiz_sample_rate = self._params.vobiz_sample_rate
        self._sample_rate = 0
        self._stream_id = None

        self._input_resampler = create_stream_resampler()
        self._output_resampler = create_stream_resampler()

    async def setup(self, frame: StartFrame):
        self._sample_rate = self._params.sample_rate or frame.audio_in_sample_rate

    async def serialize(self, frame: Frame) -> str | bytes | None:
        if isinstance(frame, InterruptionFrame):
            payload = {"event": "clearAudio"}
            if self._stream_id:
                payload["streamId"] = self._stream_id
            return json.dumps(payload)

        if isinstance(frame, AudioRawFrame):
            mulaw_data = await pcm_to_ulaw(
                frame.audio,
                frame.sample_rate,
                self._vobiz_sample_rate,
                self._output_resampler,
            )
            if not mulaw_data:
                return None

            payload = base64.b64encode(mulaw_data).decode("utf-8")
            msg = {
                "event": "playAudio",
                "media": {
                    "contentType": "audio/x-mulaw",
                    "sampleRate": self._vobiz_sample_rate,
                    "payload": payload,
                },
            }
            if self._stream_id:
                msg["streamId"] = self._stream_id
            return json.dumps(msg)

        return None

    async def deserialize(self, data: str | bytes) -> Frame | None:
        try:
            message = json.loads(data)
        except Exception:
            return None

        event = message.get("event")

        if event == "media":
            payload_b64 = message.get("media", {}).get("payload")
            if not payload_b64:
                return None

            mulaw_bytes = base64.b64decode(payload_b64)
            pcm_data = await ulaw_to_pcm(
                mulaw_bytes,
                self._vobiz_sample_rate,
                self._sample_rate,
                self._input_resampler,
            )
            if not pcm_data:
                return None

            return InputAudioRawFrame(
                audio=pcm_data,
                num_channels=1,
                sample_rate=self._sample_rate,
            )

        elif event == "start":
            logger.info(f"Vobiz stream started: {message}")
            self._stream_id = message.get("start", {}).get("streamId")
            return None

        elif event == "stop":
            logger.info("Vobiz stream stopped")
            return None

        return None
