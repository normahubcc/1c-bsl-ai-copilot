"""Run an IDE test command on a private X11 display without focusing the desktop."""
import argparse
import os
from pathlib import Path
import select
import subprocess
import time


def stop(process):
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=8)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xvfb", type=Path, required=True)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    if not args.xvfb.is_file() or not os.access(args.xvfb, os.X_OK):
        parser.error("A previously provisioned executable Xvfb is required")
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("Pass the IDE test command after --")
    read_end, write_end = os.pipe()
    display = subprocess.Popen([str(args.xvfb), "-displayfd", str(write_end), "-screen", "0", "1280x800x24",
                                "-nolisten", "tcp", "-noreset", "-ac"], pass_fds=(write_end,),
                               stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    os.close(write_end)
    try:
        deadline = time.monotonic() + 15
        response = b""
        while b"\n" not in response and time.monotonic() < deadline:
            if display.poll() is not None:
                raise RuntimeError("Private Xvfb exited: " + display.stderr.read().decode(errors="replace")[-1000:])
            ready, _, _ = select.select([read_end], [], [], min(0.2, deadline - time.monotonic()))
            if ready:
                response += os.read(read_end, 32)
        number = response.decode().strip()
        if not number.isdecimal():
            raise RuntimeError("Private Xvfb did not provide a display number")
        environment = os.environ.copy()
        environment["DISPLAY"] = ":" + number
        environment["XDG_SESSION_TYPE"] = "x11"
        environment["ELECTRON_OZONE_PLATFORM_HINT"] = "x11"
        environment.pop("WAYLAND_DISPLAY", None)
        environment.pop("XAUTHORITY", None)
        print("Private X11 display :" + number + " ready", flush=True)
        child = subprocess.Popen(command, env=environment, start_new_session=True)
        try:
            return child.wait()
        finally:
            stop(child)
    finally:
        os.close(read_end)
        stop(display)


if __name__ == "__main__":
    raise SystemExit(main())
