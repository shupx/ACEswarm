#!/usr/bin/env python3
"""Stage the approved Store versions for first-workspace bootstrap."""
import argparse
import hashlib
import json
import pathlib
import tempfile
import urllib.request

APPS = [
    ("app_comm_status_viewer_2026042816_bc6b", "0.2.2"),
    ("app_swarm_controlpad_2026043022_d04b", "0.2.1"),
    ("app_swarm_dashboard_2026042621_5e65", "0.2.1"),
    ("app_panel_hub_2026042422_9ec8", "0.1.0"),
    ("app_hello_world_examle_2026040813_429c", "1.1.0"),
]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--store-url", required=True, help="Local AppStore origin")
    args = parser.parse_args()
    base = args.store_url.rstrip("/")
    root = pathlib.Path(__file__).resolve().parents[1] / "resources/seed-apps"
    export_path = root / "aceswarm-config-export.json"
    document = json.loads(export_path.read_text())
    packages, apps = [], []
    with tempfile.TemporaryDirectory(dir=root) as scratch:
        staged = pathlib.Path(scratch)
        for app_id, version in APPS:
            route = f"/aivuda_app_store/store/apps/{app_id}/versions/{version}"
            with urllib.request.urlopen(base + route + "/download-url", timeout=60) as response:
                metadata = json.load(response)
            filename = metadata["filename"]
            if pathlib.Path(filename).name != filename:
                raise ValueError("Invalid Store filename")
            with urllib.request.urlopen(base + metadata["url"], timeout=180) as response:
                data = response.read()
            digest = hashlib.sha256(data).hexdigest()
            if len(data) != metadata["size"] or digest != metadata["sha256"]:
                raise ValueError(f"Store artifact verification failed: {app_id}")
            (staged / filename).write_bytes(data)
            packages.append({"artifact": "packages/" + filename, "sha256": digest})
            apps.append({"app_id": app_id, "name": app_id, "version": version,
                         "autostart": False, "running": False, "parameters": {}})
            print(f"Verified {app_id}@{version}")
        destination = root / "packages"
        expected = {p["artifact"].split("/", 1)[1] for p in packages}
        for file in staged.iterdir():
            file.replace(destination / file.name)
        old = {p["artifact"].split("/", 1)[1] for p in document["aceswarm"]["packages"]}
        for filename in old - expected:
            if pathlib.Path(filename).name != filename:
                raise ValueError("Invalid old artifact filename")
            (destination / filename).unlink(missing_ok=True)
    document["aceswarm"]["packages"] = packages
    document["payload"]["apps"] = apps
    document["human_header"]["selected"]["app_count"] = len(apps)
    export_path.write_text(json.dumps(document, indent=2) + "\n")


if __name__ == "__main__":
    main()
