import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import anthropic

from .settings import AgentSettings

BETAS = ["thinking-binding-controls-2026-08-01"]


@dataclass
class ToolCall:
    id: str
    name: str
    input: dict


@dataclass
class LLMResult:
    text: str
    tool_calls: list[ToolCall]
    content_blocks: list[dict]
    stop_reason: str | None
    usage: dict
    latency_ms: int
    model: str


def make_client(settings: AgentSettings) -> anthropic.AsyncAnthropic:
    if settings.llm_provider == "bedrock":
        # Mantle is the Messages-API Bedrock endpoint; older SDKs only have the InvokeModel client.
        cls = getattr(anthropic, "AsyncAnthropicBedrockMantle", None) or anthropic.AsyncAnthropicBedrock
        return cls(aws_region=settings.aws_region)
    return anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key or None)


def resolve_model(settings: AgentSettings) -> str:
    model = settings.llm_model
    if settings.llm_provider == "rork":
        return model
    if "/" in model:
        # Accept LiteLLM-style "anthropic/claude-..." from the original spec.
        model = model.split("/", 1)[1]
    if settings.llm_provider == "bedrock" and not model.startswith(("anthropic.", "us.", "eu.", "apac.", "global.")):
        model = f"anthropic.{model}"
    return model


class LLMClient:
    def __init__(self, settings: AgentSettings):
        self.settings = settings
        self.model = resolve_model(settings)
        self._client: anthropic.AsyncAnthropic | None = None

    @property
    def client(self) -> anthropic.AsyncAnthropic:
        if self._client is None:
            self._client = make_client(self.settings)
        return self._client

    async def complete(
        self,
        system: str,
        messages: list[dict],
        tools: list[dict],
        on_text: Callable[[str], Awaitable[None]] | None = None,
    ) -> LLMResult:
        if self.settings.llm_provider == "rork":
            from .rork_llm import complete
            return await complete(self.settings, system, messages, tools, on_text)
        start = time.monotonic()
        async with self.client.beta.messages.stream(
            model=self.model,
            max_tokens=8192,
            system=[{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}],
            messages=messages,
            tools=tools,
            tool_choice={"type": "auto", "disable_parallel_tool_use": True},
            # drop_block lets us compact old observations without a 400 from the
            # preserved-thinking check on the 5.x models.
            thinking={"type": "adaptive", "block_binding": {"prefix_mismatch_behavior": "drop_block"}},
            output_config={"effort": self.settings.llm_effort},
            betas=BETAS,
            timeout=self.settings.llm_timeout_seconds,
        ) as stream:
            async for text in stream.text_stream:
                if on_text:
                    await on_text(text)
            message = await stream.get_final_message()

        blocks = [b.model_dump(exclude_none=True) for b in message.content]
        tool_calls = [ToolCall(b["id"], b["name"], b.get("input") or {}) for b in blocks if b.get("type") == "tool_use"]
        text = "".join(b["text"] for b in blocks if b.get("type") == "text")
        usage = message.usage.model_dump(exclude_none=True) if message.usage else {}
        return LLMResult(
            text=text,
            tool_calls=tool_calls,
            content_blocks=blocks,
            stop_reason=message.stop_reason,
            usage={k: v for k, v in usage.items() if isinstance(v, int)},
            latency_ms=int((time.monotonic() - start) * 1000),
            model=self.model,
        )
