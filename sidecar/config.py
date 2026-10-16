"""Configuration settings for 1C Configurator Global Sidecar."""

import os
from dataclasses import dataclass


@dataclass
class SidecarConfig:
    api_key: str = os.getenv("NORMAHUB_API_KEY", "")
    base_url: str = os.getenv("NORMAHUB_BASE_URL", "https://api.normahub.cc/v1")
    autocomplete_model: str = os.getenv("NORMAHUB_MODEL", "deepseek-v4.1-flash")
    reasoning_model: str = os.getenv("NORMAHUB_REASONING_MODEL", "gpt-6.1-sol")
    port: int = int(os.getenv("SIDECAR_PORT", "18833"))
    host: str = os.getenv("SIDECAR_HOST", "127.0.0.1")
    auto_paste: bool = os.getenv("SIDECAR_AUTO_PASTE", "false").lower() in ("true", "1")

    @property
    def is_loopback(self) -> bool:
        return self.host in ("127.0.0.1", "localhost", "::1")

    def validate(self) -> None:
        if not self.is_loopback and not os.getenv("SIDECAR_AUTH_TOKEN", "").strip():
            raise ValueError(
                "SIDECAR_AUTH_TOKEN is required when SIDECAR_HOST is not loopback"
            )


def load_config() -> SidecarConfig:
    config = SidecarConfig()
    config.validate()
    return config
