#!/usr/bin/env python3
"""Compatibility entrypoint for current Webview interaction and regression QA."""
from browser_human_emulation import run_test
from webview_regression import run_regression

if __name__ == "__main__":
    run_test()
    run_regression()
