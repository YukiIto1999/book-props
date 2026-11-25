import os
from pathlib import Path
import re
import subprocess
import sys
import time

import pyatspi

pid, operation, value = sys.argv[1:]
desktop = pyatspi.Registry.getDesktop(0)
chooser_titles = {
    "install": "Select the extension directory.",
    "folder": "Select where this site can save changes",
}
deadline = time.monotonic() + 15
evidence = Path(os.environ["RUNNER_TEMP"]) / "book-props-desktop" / "evidence"


def capture(name):
    subprocess.run(["scrot", "--overwrite", str(evidence / f"native-{name}.png")], check=False)


def until(description, action):
    while time.monotonic() < deadline:
        try:
            result = action()
            if result is not None:
                return result
        except RuntimeError:
            pass
        time.sleep(0.15)
    capture(operation)
    for app in desktop:
        if app is not None:
            print(f"AT-SPI app: {app.get_process_id()} {app.name!r}", file=sys.stderr)
    for app in apps():
        for node in descendants(app):
            name = node.name or ""
            if any(label in name for label in ("Book Props", "Allow", "Open", "Select where")):
                print(f"AT-SPI control: {node.getRoleName()} {name!r}", file=sys.stderr)
    raise RuntimeError(f"Chrome UI did not show {description}")


def descendants(node):
    yield node
    for child in node:
        if child is not None:
            yield from descendants(child)


def apps():
    return [app for app in desktop if str(app.get_process_id()) == pid]


def button(name, scope):
    for app in apps():
        for item in descendants(app):
            if item.getRole() not in (pyatspi.ROLE_PUSH_BUTTON, pyatspi.ROLE_TOGGLE_BUTTON):
                continue
            if item.name != name or not item.getState().contains(pyatspi.STATE_SHOWING):
                continue
            parent = item.parent
            for _ in range(5):
                if parent is None:
                    break
                if scope in (parent.name or "") or any(
                    scope in (node.name or "") for node in descendants(parent)
                ):
                    return item
                parent = parent.parent
    return None


def xdo(*args):
    return subprocess.check_output(["xdotool", *args], text=True).strip()


def chooser(title):
    found = subprocess.run(
        ["xdotool", "search", "--all", "--onlyvisible", "--pid", pid, "--name",
         f"^{re.escape(title)}$"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.splitlines()
    return found[0] if len(found) == 1 else None


if operation in chooser_titles:
    title = chooser_titles[operation]
    window = until("the owned folder chooser", lambda: chooser(title))
    xdo("windowactivate", "--sync", window)
    subprocess.run(
        ["xclip", "-selection", "clipboard", "-in"], input=value, text=True, check=True,
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )
    xdo("key", "--clearmodifiers", "--delay", "100", "ctrl+l", "ctrl+a", "ctrl+v")
    capture(f"{operation}-path")

    geometry = subprocess.check_output(["xwininfo", "-id", window], text=True)
    width = int(re.search(r"\bWidth:\s+(\d+)", geometry)[1])
    height = int(re.search(r"\bHeight:\s+(\d+)", geometry)[1])
    if xdo("getactivewindow") != window or width < 300 or height < 200:
        raise RuntimeError("Chrome's folder chooser is not the active GTK window")
    # Both GTK choosers use Adwaita at scale 1; Open is the rightmost action.
    xdo("mousemove", "--window", window, str(width - 50), str(height - 23), "click", "1")
    until("confirmation of the owned folder chooser", lambda: True if chooser(title) is None else None)
else:
    labels = {"folder-permission": "Allow", "folder-persist": "Allow on every visit"}
    allow = until(labels[operation], lambda: button(labels[operation], "Book Props"))
    allow.queryAction().doAction(0)
