#!/usr/bin/env python3
"""Re-export the original landscape brand art as UNDISTORTED square icons."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1]
source = root / "assets" / "brand-art.png"
with Image.open(source) as image:
    image = image.convert("RGB")
    width, height = image.size
    # Crop to the original artwork's central square; never stretch a 3:2 image.
    side = min(width, height)
    left = (width - side) // 2
    top = (height - side) // 2
    square = image.crop((left, top, left + side, top + side))
    for target, size in (
        ("assets/app-icon.png", 512),
        ("assets/app-icon-192.png", 192),
        ("app/static/icon.png", 512),
    ):
        destination = root / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        square.resize((size, size), Image.Resampling.LANCZOS).save(
            destination, format="PNG", optimize=True
        )
        print(f"Updated {target}: {size}x{size} (correct original proportions)")
