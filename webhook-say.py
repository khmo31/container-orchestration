#!/usr/bin/env python3
"""
webhook-say.py — Send a message to an agent's Discord channel via webhook.

Usage:
    python3 webhook-say.py hermes "Hello from Hermes!"
    python3 webhook-say.py metagpt "$(cat output.txt)"

As a module:
    from webhook_say import say
    say("hermes", "Job done!")
"""

import json
import sys
import urllib.request

WEBHOOKS_FILE = "/home/khmo31/.openclaw/workspace/webhooks.json"


def get_webhook_url(agent_name: str) -> str:
    with open(WEBHOOKS_FILE) as f:
        hooks = json.load(f)
    url = hooks.get(agent_name)
    if not url:
        raise ValueError(f"Unknown agent '{agent_name}'. Available: {', '.join(hooks.keys())}")
    return url


def say(agent_name: str, message: str) -> None:
    """Send a message to the agent's Discord channel."""
    url = get_webhook_url(agent_name)
    payload = json.dumps({"content": message}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req) as resp:
        if resp.status != 204:
            print(f"[webhook] warning: status {resp.status}", file=sys.stderr)


def main():
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <agent_name> <message>", file=sys.stderr)
        print(f"Agents: hermes, metagpt, ejclaw, opencode, trading", file=sys.stderr)
        sys.exit(1)
    say(sys.argv[1], " ".join(sys.argv[2:]))


if __name__ == "__main__":
    main()
