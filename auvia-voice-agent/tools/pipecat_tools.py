# tools/pipecat_tools.py

from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.services.llm_service import FunctionCallParams
from pipecat.frames.frames import EndTaskFrame, TTSUpdateSettingsFrame
from pipecat.processors.frame_processor import FrameDirection


from loguru import logger

# ==========================================================
# 🛠️ TOOL FUNCTIONS
# ==========================================================

from pipecat.services.sarvam.tts import SarvamTTSService

async def switch_language(params: FunctionCallParams, language: str):
    """Switch the spoken language of the bot (English / Hindi / Telugu)."""
    lang_lower = language.lower()
    if "telugu" in lang_lower:
        lang_code = "te-IN"
    elif "hindi" in lang_lower:
        lang_code = "hi-IN"
    else:
        lang_code = "en-IN"

    logger.info(f"🗣️ Switching language to {language} | Code: {lang_code} | Voice: ritu")

    await params.llm.push_frame(
        TTSUpdateSettingsFrame(delta=SarvamTTSService.Settings(
            voice="ritu",
            language=lang_code,
            pace=1.0
        ))
    )
    await params.result_callback({"status": f"Language switched to {language.capitalize()}."})

switch_language.__name__ = "switch_language"


async def end_call(params: FunctionCallParams):
    """Ends the phone call gracefully."""
    logger.info("👋 LLM requested to end the call.")
    await params.llm.push_frame(EndTaskFrame(), FrameDirection.UPSTREAM)
    await params.result_callback({"status": "Call ending initiated."})

end_call.__name__ = "end_call"


# ==========================================================
# 📋 SCHEMAS
# ==========================================================

switch_language_schema = FunctionSchema(
    name="switch_language",
    description="Changes the spoken language of the call to English, Hindi, or Telugu.",
    properties={
        "language": {"type": "string", "description": "One of: 'english', 'hindi', or 'telugu'."}
    },
    required=["language"]
)

end_call_schema = FunctionSchema(
    name="end_call",
    description="Ends the phone call gracefully. Use when the conversation is complete, the patient asks to hang up, or no further action is needed.",
    properties={},
    required=[]
)


# ==========================================================
# 🔌 REGISTER TOOLS
# ==========================================================

def register_all_tools(llm, clinic_id: str):
    """Register only the tools needed for outbound billing calls."""
    llm.register_direct_function(switch_language)
    llm.register_direct_function(end_call)


def get_tools_schema():
    return ToolsSchema(standard_tools=[
        switch_language_schema,
        end_call_schema,
    ])
