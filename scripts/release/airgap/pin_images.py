#!/usr/bin/env python3
"""Pin release inventory entries to the images built in the local Docker engine."""
import argparse
import json
from pathlib import Path
import re
import subprocess


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("inventory", type=Path)
    args = parser.parse_args()

    def pin(match):
        ref = match[1]
        info, = json.loads(subprocess.check_output(["docker", "image", "inspect", ref], text=True))
        if info["Os"] != "linux" or info["Architecture"] != "amd64":
            raise ValueError(f"{ref} must be Linux amd64")
        return ref + match[2] + info["Id"]

    content = re.sub(r"^(docker\.io/mrshll187/\S+)(\s+)sha256:[0-9a-f]+", pin,
                     args.inventory.read_text(), flags=re.M)
    args.inventory.write_text(content)


if __name__ == "__main__":
    main()
