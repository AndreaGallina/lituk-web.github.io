"""Convert the app's content.txt into data.js for the web app.

Lesson images are hosted on the developer's website. This script downloads them into an
"images" folder next to data.js, so the web app can show them without an internet connection.
Images that are already in the folder are not downloaded again.

Usage: python3 -I build_data.py <path/to/content.txt> <path/to/data.js>
"""
import json
import os
import re
import sys
import urllib.request

src, dst = sys.argv[1], sys.argv[2]
d = json.load(open(src, encoding="utf-8"))["data"]
image_dir = os.path.join(os.path.dirname(os.path.abspath(dst)), "images")
os.makedirs(image_dir, exist_ok=True)


def local_image(m):
    url, caption = m.group(1), m.group(2)
    # Many URLs end in the same filename, e.g. ".../James/II/(1).jpg", so the whole path becomes the local name.
    name = url.split("/app-12/", 1)[-1].replace("/", "_")
    path = os.path.join(image_dir, name)
    if not os.path.exists(path):
        # The image host rejects Python's default User-Agent with HTTP 403, so send a generic one.
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            data = r.read()
        with open(path, "wb") as f:
            f.write(data)
    figcaption = f"<figcaption>{caption.strip()}</figcaption>" if caption.strip() else ""
    return f'<figure><img src="images/{name}" loading="lazy" alt="">{figcaption}</figure>'


def lesson_html(xml):
    m = re.search(r"<text>(.*)</text>", xml, re.S)
    s = m.group(1) if m else ""
    s = re.sub(r">\s+<", "><", s)
    s = re.sub(r"<h>(.*?)</h>", r"<h3>\1</h3>", s, flags=re.S)
    s = re.sub(r'<image url="([^"]+)">(.*?)</image>', local_image, s, flags=re.S)
    s = re.sub(r'<color foreground="([0-9A-Fa-f]{6})">', r'<span style="color:#\1">', s)
    s = s.replace("</color>", "</span>")
    # Links to the app's own pages ("/abc123") don't exist outside the app, so keep only the text.
    s = re.sub(r'<a href="/[^"]*">(.*?)</a>', r"\1", s, flags=re.S)
    s = re.sub(r'<a href="(https?://[^"]+)">', r'<a href="\1" target="_blank" rel="noopener">', s)
    s = re.sub(r"((?:<li>.*?</li>)+)", r"<ul>\1</ul>", s, flags=re.S)
    s = re.sub(r"\n{3,}", "\n\n", s.strip())
    s = s.replace("\n", "<br>")
    # Headings, lists and images already start on their own line, so line breaks next to them only add gaps.
    s = re.sub(r"(<br>)+(?=<h3>|<ul>|<figure>)", "", s)
    return re.sub(r"(</h3>|</ul>|</figure>)(<br>)+", r"\1", s)


def question(q):
    # Options are stored as "1 text", "2 text", ... and option 1 is always the correct one.
    # One question has a bare number instead of an option, so non-text entries are skipped.
    options = [re.sub(r"^\d+ ", "", o) for o in q["options"] if isinstance(o, str)]
    return {
        "id": q["id"],
        "type": q["type"],
        "q": q["question"],
        "options": options,
        "answer": options[0],
        "feedback": q["feedback"] or "",
    }


icons = {i["URI"]: i["data"] for i in d["images"]}
chapters = []
for c in sorted((x for x in d["content"] if x["parentId"] is None), key=lambda x: x["index"]):
    lessons = sorted((x for x in d["content"] if x["parentId"] == c["id"]), key=lambda x: x["index"])
    chapters.append({
        "id": c["id"],
        "title": c["title"],
        "icon": icons.get(f"{c['id']}.png"),
        "lessons": [
            {
                "id": l["id"],
                "title": l["title"],
                "html": lesson_html(l["data"]),
                "questions": [question(q) for q in l["questions"]],
            }
            for l in lessons
        ],
    })

tests = [
    {"id": t["id"], "title": t["title"], "minutes": t["time"], "questions": [question(q) for q in t["questions"]]}
    for t in sorted(d["tests"], key=lambda t: t["index"])
]

flashcards = [
    {"id": f["id"], "word": f["word"], "definition": f["definition"], "example": f["example"] or "", "caption": f["caption"] or ""}
    for f in d["flashCards"]
]

out = {"passPercent": d["app"]["data"]["meta"]["passPercent"], "chapters": chapters, "tests": tests, "flashcards": flashcards}
with open(dst, "w", encoding="utf-8") as f:
    f.write("window.DATA = ")
    json.dump(out, f, ensure_ascii=False)
    f.write(";\n")

print(f"{len(chapters)} chapters, {sum(len(c['lessons']) for c in chapters)} lessons, "
      f"{len(tests)} tests, {len(flashcards)} flashcards")
