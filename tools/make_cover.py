from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
source = Image.open(ROOT / "evidence" / "home-delay.png").convert("RGB")
canvas = Image.new("RGB", (1200, 630), "#1b1022")
draw = ImageDraw.Draw(canvas)
width, height = source.size
crop = source.crop((int(width * 0.52), int(height * 0.12), int(width * 0.98), int(height * 0.82)))
crop.thumbnail((670, 570))
canvas.paste(crop, (560, 30))
draw.rectangle((0, 0, 22, 630), fill="#b9f33c")
draw.rectangle((530, 0, 548, 630), fill="#ff7138")
font_root = Path("C:/Windows/Fonts")
def font(name, size):
    return ImageFont.truetype(str(font_root / name), size)
draw.text((68, 58), "KIMI GAMES · LOB7", font=font("arial.ttf", 20), fill="#ff8a59")
draw.text((62, 112), "SCRAP", font=font("arialbd.ttf", 86), fill="#b9f33c")
draw.text((62, 200), "LEAGUE", font=font("arialbd.ttf", 86), fill="#b9f33c")
draw.text((68, 320), "LA LIGUE DES", font=font("arialbd.ttf", 28), fill="#f3efdc")
draw.text((68, 356), "FERRAILLEURS", font=font("arialbd.ttf", 28), fill="#f3efdc")
draw.text((68, 440), "BUILD. BOLT. BRAWL.", font=font("arialbd.ttf", 22), fill="#b9c5c8")
draw.text((68, 500), "3 machines · 10 modules · 6 fights", font=font("arial.ttf", 19), fill="#b9c5c8")
draw.ellipse((1130, 548, 1170, 588), outline="#b9f33c", width=5)
draw.ellipse((1142, 560, 1158, 576), fill="#ff7138")
out = ROOT / "art"
out.mkdir(exist_ok=True)
canvas.save(out / "cover.png", optimize=True)
print(out / "cover.png")
