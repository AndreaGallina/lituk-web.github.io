"""Convert the app's content.txt into data.js for the web app.

Lesson images are hosted on the developer's website. This script downloads them into an
"images" folder next to data.js, so the web app can show them without an internet connection.
Images that are already in the folder are not downloaded again.

The optional third argument is the site_tests.json file made from lifeintheuktestweb.co.uk.
Its tests are added as "extraTests", kept separate from the app's own tests.

Usage: python3 -I build_data.py <path/to/content.txt> <path/to/data.js> [path/to/site_tests.json]
"""
import collections
import json
import math
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

extra_tests = []
if len(sys.argv) > 3:
    # The same question appears in several of the site's tests. Copies share one id, so the
    # app's record of right and wrong answers for a question applies wherever it appears.
    first_id = {}
    for t in json.load(open(sys.argv[3], encoding="utf-8"))["tests"]:
        questions = []
        for q in t["questions"]:
            key = (q["question"], tuple(sorted(q["options"])))
            qid = first_id.setdefault(key, f'{t["slug"]}-{q["number"]}')
            item = {"id": qid, "q": q["question"], "options": q["options"],
                    "feedback": q["explanation"]}
            # Questions with several correct answers store them as a list in "answers".
            if len(q["correct"]) > 1:
                item["answers"] = q["correct"]
            else:
                item["answer"] = q["correct"][0]
            questions.append(item)
        extra_tests.append({"id": t["slug"], "series": t["series"], "title": t["title"], "url": t["url"],
                            "minutes": t["minutes"], "questions": questions})

# ---------- Topics ----------
# Every question gets a "topic": the id of the lesson it is about. Lesson questions use their own
# lesson. Other questions are matched to the lesson whose text has the most words in common with
# the question, its correct answer and its explanation, with rare words counting more (TF-IDF).
# Checked against the app's lesson questions this picks the right lesson 97% of the time; for
# the differently worded site questions a hand-checked sample was about 87% right.
STOP = set("""a an the of in on at to for from by with and or not is are was were be been it its this that these
which who whom what when where why how do does did you your their there they he she his her we our as than then
also only can could would should may might must has have had following true false statement statements correct
one two three four about into over under after before during who's all any some such other more most many""".split())


def words(text):
    out = []
    for w in re.findall(r"[a-z0-9]+", re.sub(r"<[^>]+>", " ", text.lower())):
        if w not in STOP and len(w) >= 3:
            out.append(w[:-1] if w.endswith("s") and len(w) > 4 else w)  # crude plural removal
    return out


all_lessons = [l for c in chapters for l in c["lessons"]]
lesson_counts = {l["id"]: collections.Counter(words(l["html"])) for l in all_lessons}
idf = {w: math.log(len(lesson_counts) / n)
       for w, n in collections.Counter(w for c in lesson_counts.values() for w in c).items()}


def unit_vector(counts):
    v = {w: (1 + math.log(n)) * idf.get(w, 0) for w, n in counts.items()}
    norm = math.sqrt(sum(x * x for x in v.values())) or 1
    return {w: x / norm for w, x in v.items() if x}


lesson_vectors = {lid: unit_vector(c) for lid, c in lesson_counts.items()}


def topic_of(q):
    text = q["q"] + " " + " ".join(q.get("answers") or [q["answer"]]) + " " + q["feedback"]
    v = unit_vector(collections.Counter(words(text)))
    return max(lesson_vectors, key=lambda lid: sum(x * lesson_vectors[lid].get(w, 0) for w, x in v.items()))


for l in all_lessons:
    for q in l["questions"]:
        q["topic"] = l["id"]
for t in tests + extra_tests:
    for q in t["questions"]:
        q["topic"] = topic_of(q)

out = {"passPercent": d["app"]["data"]["meta"]["passPercent"], "chapters": chapters, "tests": tests,
       "extraTests": extra_tests, "flashcards": flashcards}
with open(dst, "w", encoding="utf-8") as f:
    f.write("window.DATA = ")
    json.dump(out, f, ensure_ascii=False)
    f.write(";\n")

print(f"{len(chapters)} chapters, {sum(len(c['lessons']) for c in chapters)} lessons, "
      f"{len(tests)} tests, {len(extra_tests)} extra tests, {len(flashcards)} flashcards")
