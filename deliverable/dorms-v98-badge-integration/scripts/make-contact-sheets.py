from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "evidence" / "deep-qa"
OUTPUT = ROOT / "evidence" / "contact-sheets"
OUTPUT.mkdir(parents=True, exist_ok=True)


def sheet(prefix: str, columns: int, width: int = 260, height: int = 194) -> None:
    files = sorted(SOURCE.glob(f"{prefix}-*.png"))
    rows = (len(files) + columns - 1) // columns
    canvas = Image.new("RGB", (columns * width, rows * (height + 28)), "#eef3fb")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    for index, file in enumerate(files):
        image = Image.open(file).convert("RGB")
        image.thumbnail((width, height))
        x = (index % columns) * width + (width - image.width) // 2
        y = (index // columns) * (height + 28)
        canvas.paste(image, (x, y))
        label = file.stem.removeprefix(prefix + "-")
        draw.text((index % columns * width + 6, y + height + 6), label, fill="#102444", font=font)
    canvas.save(OUTPUT / f"{prefix}.jpg", quality=92)


for name, cols in (("expression", 5), ("action", 4), ("combo", 4), ("badge", 5), ("simultaneous", 3), ("season", 4)):
    sheet(name, cols)
