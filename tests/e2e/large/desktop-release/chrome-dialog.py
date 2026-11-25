import os
import subprocess
import sys
import time

import pyatspi

pid, operation, value = sys.argv[1:]
desktop = pyatspi.Registry.getDesktop(0)
deadline = time.monotonic() + 15


def until(description, action):
    while time.monotonic() < deadline:
        try:
            result = action()
            if result is not None:
                return result
        except RuntimeError:
            pass
        time.sleep(0.15)
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
                if any(scope in (node.name or "") for node in descendants(parent)):
                    return item
                parent = parent.parent
    return None


def xdo(*args):
    return subprocess.check_output(["xdotool", *args], text=True).strip()


def chooser():
    found = subprocess.run(
        ["xdotool", "search", "--all", "--onlyvisible", "--pid", pid, "--name",
         "^Select where this site can save changes$"],
        capture_output=True,
        text=True,
        check=False,
    ).stdout.splitlines()
    return found[0] if len(found) == 1 else None


if operation == "folder":
    window = until("the owned folder chooser", chooser)
    xdo("windowraise", window, "windowfocus", "--sync", window)
    xdo("key", "ctrl+l")
    xdo("type", "--", value + os.sep)
    xdo("key", "Return")
    select = until("the selected folder", lambda: button("Open", os.path.basename(value)))
    select.queryAction().doAction(0)
else:
    labels = {"folder-permission": "Allow", "folder-persist": "Allow on every visit"}
    allow = until(labels[operation], lambda: button(labels[operation], "Book Props"))
    allow.queryAction().doAction(0)
