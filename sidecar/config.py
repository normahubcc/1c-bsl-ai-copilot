"""Configuration settings for 1C Configurator Global Sidecar."""

import os
from dataclasses import dataclass


@dataclass
class SidecarConfig:
    api_key: str = os.getenv("NORMAHUB_API_KEY", "")
    base_url: str = os.getenv("NORMAHUB_BASE_URL", "https://api.normahub.cc/v1")
    autocomplete_model: str = os.getenv("NORMAHUB_MODEL", "deepseek-v4.1-flash")
    reasoning_model: str = os.getenv("NORMAHUB_REASONING_MODEL", "claude-sonnet-5-5")
    port: int = int(os.getenv("SIDECAR_PORT", "18833"))
    host: str = os.getenv("SIDECAR_HOST", "127.0.0.1")
    auto_paste: bool = os.getenv("SIDECAR_AUTO_PASTE", "false").lower() in ("true", "1")


def load_config() -> SidecarConfig:
    return SidecarConfig()
