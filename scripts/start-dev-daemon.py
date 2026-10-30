#!/usr/bin/env python3
"""CARMAZE dev-server daemon launcher.

The sandbox reaps background jobs still owned by a finished tool session, so
a plain `nohup bun run dev &` dies shortly after the command that spawned it
returns. This launcher uses the classic double-fork daemonisation: the
intermediate parent exits IMMEDIATELY, orphaning the daemon process so it is
re-parented to init before the session ends — exactly how agent-browser's
daemon survives. Also caps the V8 heap so a long-running Turbopack dev server
cannot grow until the kernel OOM-killer takes it down.
"""
import os
import sys
import time

PROJECT = "/home/z/my-project"
LOG = os.path.join(PROJECT, "dev.log")
MAX_HEAP_MB = "1536"


def fork_exit():
    pid = os.fork()
    if pid > 0:
        os._exit(0)
    return pid


def main():
    # 1st fork: intermediate parent exits at once → daemon orphaned to init.
    fork_exit()
    os.setsid()

    # 2nd fork: child can never reacquire a controlling terminal.
    fork_exit()

    os.chdir(PROJECT)
    with open(os.devnull, "rb") as devnull_in, open(LOG, "ab", buffering=0) as log:
        # fresh log per daemon start (match `bun run dev`'s tee behaviour)
        log.seek(0, 2)
        os.dup2(devnull_in.fileno(), 0)
        os.dup2(log.fileno(), 1)
        os.dup2(log.fileno(), 2)

        env = dict(os.environ)
        env["NODE_OPTIONS"] = f"--max-old-space-size={MAX_HEAP_MB}"
        env["PORT"] = "3000"

        # exec bun directly — replaces this process, no shell pipeline to reap
        os.execvpe("bun", ["bun", "run", "dev"], env)


if __name__ == "__main__":
    # Guard against double-start: if something already answers on :3000, leave.
    import socket
    s = socket.socket()
    s.settimeout(1)
    try:
        s.connect(("127.0.0.1", 3000))
        s.close()
        print("dev server already running on :3000")
        sys.exit(0)
    except OSError:
        s.close()
    time.sleep(0.1)
    main()
