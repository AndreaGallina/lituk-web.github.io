'use strict';

const D = window.DATA;
const $app = document.getElementById('app');

// Progress is kept in the browser's localStorage, so it survives reloads on the same browser.
const KEY = 'lituk-progress-v1';
const progress = Object.assign({ lessons: {}, tests: {}, known: {}, chapters: {}, extra: {}, review: {}, custom: [] }, JSON.parse(localStorage.getItem(KEY) || '{}'));
const save = () => localStorage.setItem(KEY, JSON.stringify(progress));

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const pct = (n, total) => total ? Math.round(n * 100 / total) : 0;
const bar = (n, total) => `<div class="bar"><span style="width:${pct(n, total)}%"></span></div>`;
const fmtTime = ms => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
const shuffle = list => {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const lessonById = new Map();
const chapterOfLesson = new Map();
for (const c of D.chapters) for (const l of c.lessons) { lessonById.set(l.id, l); chapterOfLesson.set(l.id, c); }
const chapterById = new Map(D.chapters.map(c => [c.id, c]));
const chapterQuestions = c => c.lessons.flatMap(l => l.questions);
const testById = new Map(D.tests.map(t => [t.id, t]));
const extraTestById = new Map(D.extraTests.map(t => [t.id, t]));
// Every distinct question from lessons, app tests and extra tests. Each has a "topic" (a lesson id).
const questionById = new Map();
for (const q of [...[...lessonById.values()].flatMap(l => l.questions), ...[...D.tests, ...D.extraTests].flatMap(t => t.questions)]) {
  if (!questionById.has(String(q.id))) questionById.set(String(q.id), q);
}
const cardById = new Map(D.flashcards.map(c => [c.id, c]));

const render = html => { $app.innerHTML = html; };
const notFound = () => `<h1>Page not found</h1><a class="btn" href="#/study">Go to Study</a>`;

// ---------- Study ----------

function studyPage() {
  const chapters = D.chapters.map(c => {
    const done = c.lessons.filter(l => progress.lessons[l.id]?.done).length;
    return `<a class="card" href="#/chapter/${c.id}">
      ${c.icon ? `<img class="icon" src="data:image/png;base64,${c.icon}" alt="">` : ''}
      <div class="grow">
        <div class="title">${esc(c.title)}</div>
        ${bar(done, c.lessons.length)}
        <div class="muted">${done} of ${c.lessons.length} lessons completed</div>
      </div></a>`;
  }).join('');
  return `<h1>Study</h1>${chapters}
    <div class="actions"><button class="btn link" data-action="reset">Reset all progress</button></div>`;
}

function chapterPage(id) {
  const c = chapterById.get(+id);
  if (!c) return notFound();
  const total = chapterQuestions(c).length;
  const best = progress.chapters[c.id]?.best;
  const lessons = c.lessons.map((l, i) => {
    const p = progress.lessons[l.id];
    const sub = p?.quiz !== undefined ? `Best quiz score: ${p.quiz}%` : `${l.questions.length} practice questions`;
    return `<a class="card" href="#/lesson/${l.id}">
      <span class="num ${p?.done ? 'done' : ''}">${p?.done ? '✓' : i + 1}</span>
      <div class="grow"><div class="title">${esc(l.title)}</div><div class="muted">${sub}</div></div></a>`;
  }).join('');
  return `<a class="back" href="#/study">‹ Study</a><h1>${esc(c.title)}</h1>${lessons}
    ${total ? `<div class="actions">
      <a class="btn primary" href="#/practice/${c.id}">Start Chapter Practice</a>
      <span class="muted">All ${total} questions from this chapter${best !== undefined ? ` · best score ${best}%` : ''}</span>
    </div>` : ''}`;
}

function lessonPage(id) {
  const l = lessonById.get(+id);
  if (!l) return notFound();
  const c = chapterOfLesson.get(l.id);
  const next = c.lessons[c.lessons.indexOf(l) + 1];
  const done = progress.lessons[l.id]?.done;
  return `<a class="back" href="#/chapter/${c.id}">‹ ${esc(c.title)}</a>
    <h1>${esc(l.title)}</h1>
    <article class="lesson">${l.html}</article>
    <div class="actions">
      ${l.questions.length ? `<a class="btn primary" href="#/quiz/${l.id}">Practise ${l.questions.length} questions</a>` : ''}
      <button class="btn" data-action="done" data-id="${l.id}">${done ? '✓ Completed' : 'Mark as completed'}</button>
      ${next ? `<a class="btn" href="#/lesson/${next.id}">Next: ${esc(next.title)} ›</a>` : ''}
    </div>`;
}

// ---------- Tests ----------

function testCard(t, p, href, extra) {
  const passed = p && p.best >= D.passPercent;
  return `<a class="card ${extra ? 'extra' : ''}" href="${href}">
      <div class="grow"><div class="title">${esc(t.title)}</div>
        <div class="muted">${p ? `Best ${p.best}% · last ${p.last}% · ${p.attempts} attempt${p.attempts > 1 ? 's' : ''}` : 'Not taken yet'}</div></div>
      ${p ? `<span class="badge ${passed ? 'pass' : 'fail'}">${passed ? 'Pass' : 'Fail'}</span>` : ''}</a>`;
}

function testsPage() {
  const tests = D.tests.map(t => testCard(t, progress.tests[t.id], `#/test/${t.id}`, false)).join('');
  return `${customPanel()}
    <h1>Practice tests</h1>
    <p class="muted">Each test has 24 questions and a 45-minute time limit, like the real test. You need ${D.passPercent}% (18 correct answers) to pass.</p>
    ${tests}`;
}

// ---------- Mistake tracking and custom tests ----------
// Every answer is recorded per question in progress.review as { right, wrong, box, due }.
// This works like Anki's Leitner boxes:
// - A wrong answer puts the question in box 0, due for review straight away.
// - Each right answer moves it up one box, and the next review waits longer (REVIEW_DAYS).
// - In box 5 the question counts as mastered and is no longer reviewed, unless it is answered wrong again.
// - A question that has never been answered wrong has box null and is not scheduled for review.

const DAY = 86400000;
const REVIEW_DAYS = [0, 1, 3, 7, 14];
const MASTERED_BOX = 5;
const CUSTOM_SIZE = 24;
const CUSTOM_REVIEW_MAX = 16;
const CUSTOM_WEAK_SHARE = 0.75;

function record(q, ok) {
  const r = progress.review[q.id] || { right: 0, wrong: 0, box: null, due: 0 };
  if (ok) {
    r.right++;
    if (r.box !== null) {
      r.box = Math.min(r.box + 1, MASTERED_BOX);
      r.due = Date.now() + (REVIEW_DAYS[r.box] ?? 0) * DAY;
    }
  } else {
    r.wrong++;
    r.box = 0;
    r.due = Date.now();
  }
  progress.review[q.id] = r;
}

const inReview = q => { const r = progress.review[q.id]; return r && r.box !== null && r.box < MASTERED_BOX; };
const isDue = q => inReview(q) && progress.review[q.id].due <= Date.now();

// Error rate per topic. Topics with few answers are pulled towards the overall error rate,
// so one unlucky answer does not make a topic look weak.
function topicStats() {
  const stats = new Map([...lessonById.keys()].map(id => [id, { right: 0, wrong: 0, due: 0, questions: 0 }]));
  let right = 0, wrong = 0;
  for (const q of questionById.values()) {
    const s = stats.get(q.topic);
    const r = progress.review[q.id];
    s.questions++;
    if (r) { s.right += r.right; s.wrong += r.wrong; right += r.right; wrong += r.wrong; }
    if (isDue(q)) s.due++;
  }
  const overall = (wrong + 1) / (right + wrong + 2);
  for (const s of stats.values()) {
    s.answered = s.right + s.wrong;
    s.weakness = (s.wrong + 3 * overall) / (s.answered + 3);
  }
  return { stats, answered: right + wrong, overall };
}

const weightedPick = items => {
  let x = Math.random() * items.reduce((sum, it) => sum + it.weight, 0);
  return items.find(it => (x -= it.weight) < 0) || items[items.length - 1];
};

function buildCustomTest() {
  // 1. Mistakes that are due for review: lowest box first, then the longest overdue.
  const due = [...questionById.values()].filter(isDue).sort((a, b) =>
    progress.review[a.id].box - progress.review[b.id].box || progress.review[a.id].due - progress.review[b.id].due);
  const picked = due.slice(0, CUSTOM_REVIEW_MAX);
  const taken = new Set(picked.map(q => q.id));

  // 2. Fill up: 75% of the remaining places from weak topics (error rate above your overall rate,
  //    weaker topics picked more often) and the rest from any other topic, for broad coverage.
  //    Questions waiting for a later review are left out, so the spacing is kept.
  //    Within a topic, questions never answered come first.
  const { stats, overall } = topicStats();
  const pools = new Map();
  for (const q of shuffle([...questionById.values()])) {
    if (taken.has(q.id) || inReview(q)) continue;
    if (!pools.has(q.topic)) pools.set(q.topic, []);
    pools.get(q.topic).push(q);
  }
  for (const pool of pools.values()) pool.sort((a, b) => !!progress.review[a.id] - !!progress.review[b.id]);
  const isWeak = t => stats.get(t).answered && stats.get(t).weakness > overall;
  const weakPlaces = Math.round((CUSTOM_SIZE - picked.length) * CUSTOM_WEAK_SHARE);
  for (let i = 0; picked.length < CUSTOM_SIZE; i++) {
    const open = [...pools.keys()].filter(t => pools.get(t).length);
    const weak = open.filter(isWeak);
    const topics = i < weakPlaces && weak.length
      ? weak.map(t => ({ topic: t, weight: stats.get(t).weakness }))
      : open.filter(t => !isWeak(t)).map(t => ({ topic: t, weight: 1 }));
    if (!topics.length) break;
    picked.push(pools.get(weightedPick(topics).topic).shift());
  }
  return { title: 'Custom test', minutes: 45, questions: shuffle(picked), review: Math.min(due.length, CUSTOM_REVIEW_MAX) };
}

function weakestTopics(stats, count) {
  return [...stats.entries()].filter(([, s]) => s.answered >= 3)
    .sort((a, b) => b[1].weakness - a[1].weakness).slice(0, count);
}

function customPanel() {
  const { stats, answered } = topicStats();
  const due = [...questionById.values()].filter(isDue).length;
  const last = progress.custom[progress.custom.length - 1];
  const weak = weakestTopics(stats, 3).map(([id]) => esc(lessonById.get(id).title)).join(', ');
  return `<div class="custom-banner">
      <h1>Custom test</h1>
      <p>A new test is made each time from your own answers: questions you got wrong that are due for review,
      plus questions from the topics where you make the most mistakes. 24 questions, 45 minutes.</p>
      ${answered ? `<p class="muted">${due} mistake${due === 1 ? '' : 's'} due for review${weak ? ` · weakest topics: ${weak}` : ''}${last ? ` · last custom test: ${last.score}%` : ''}</p>
      <div class="actions"><a class="btn custom" href="#/custom">Start a custom test</a><a href="#/stats">Topic statistics ›</a></div>`
      : `<p class="muted">Answer some questions first (in any test, lesson quiz or chapter practice), so the app knows what to focus on.</p>`}
    </div>`;
}

function statsPage() {
  const { stats, answered } = topicStats();
  const wrong = [...stats.values()].reduce((sum, s) => sum + s.wrong, 0);
  const all = [...questionById.values()];
  const count = test => all.filter(test).length;
  const scheduled = count(inReview), due = count(isDue);
  const mastered = count(q => progress.review[q.id]?.box === MASTERED_BOX);
  const rows = [...stats.entries()].filter(([, s]) => s.answered).sort((a, b) => b[1].weakness - a[1].weakness)
    .map(([id, s]) => {
      const rate = pct(s.wrong, s.answered);
      return `<div class="card topic">
        <div class="grow"><div class="title">${esc(lessonById.get(id).title)}</div>
          <div class="muted">${esc(chapterOfLesson.get(id).title)} · ${s.answered} answer${s.answered === 1 ? '' : 's'} · ${rate}% wrong${s.due ? ` · ${s.due} due for review` : ''}</div>
          <div class="bar weak"><span style="width:${rate}%"></span></div></div></div>`;
    }).join('');
  const unseen = [...stats.values()].filter(s => !s.answered && s.questions).length;
  return `<a class="back" href="#/tests">‹ Tests</a><h1>Topic statistics</h1>
    <p>${answered} answers recorded · ${pct(wrong, answered)}% wrong overall · ${due} mistakes due for review now ·
      ${scheduled - due} waiting for a later review · ${mastered} mastered</p>
    <p class="muted">Topics are the app's lessons. Questions from the app's tests and the Extra tests were matched to a lesson
      automatically, so a few of them may be counted under a neighbouring topic.</p>
    <h2>Topics, weakest first</h2>${rows || '<p class="muted">No answers recorded yet.</p>'}
    ${unseen ? `<p class="muted">${unseen} topics have no answers yet.</p>` : ''}`;
}

// ---------- Extra tests (from lifeintheuktestweb.co.uk) ----------
// These are kept apart from the app's own tests: separate page, separate colour and separate scores.

function extraPage() {
  // Same sections, names and order as the site's /exams/ and /tests/ pages.
  const groups = [['Exams', 'exams'], ['Tests', 'tests']];
  const sections = groups.map(([series, path]) => {
    const tests = D.extraTests.filter(t => t.series === series);
    return `<h2>${series} 1–${tests.length}
        <a class="muted source" href="https://lifeintheuktestweb.co.uk/${path}/" target="_blank" rel="noopener">as on the site's ${series} page ›</a></h2>`
      + tests.map(t => testCard(t, progress.extra[t.id], `#/extra-test/${t.id}`, true)).join('');
  }).join('');
  return `<div class="extra-banner">
      <h1>Extra tests</h1>
      <p>${D.extraTests.length} practice tests from <a href="https://lifeintheuktestweb.co.uk" target="_blank" rel="noopener">lifeintheuktestweb.co.uk</a>.
      Their questions are different from the app's own tests, and their scores are kept separately.
      Each test has 24 questions and 45 minutes. Some questions have more than one correct answer.</p>
    </div>${sections}`;
}

// ---------- Question runner (lesson quizzes, chapter practice and practice tests) ----------
// A lesson quiz or chapter practice shows the right answer after each question.
// A practice test ("exam") has a timer and only shows answers at the end.

let run = null;
let timer = null;

// A question has one correct answer ("answer") or several ("answers").
// The user's answer to a question is the list of options they selected.
const correctAnswers = q => q.answers || [q.answer];
const isComplete = (q, a) => a?.length === correctAnswers(q).length;
const isCorrect = (q, a) => isComplete(q, a) && a.every(o => correctAnswers(q).includes(o));
const stopTimer = () => { clearInterval(timer); timer = null; };

function startRun(kind, id) {
  const chapter = kind === 'practice' && chapterById.get(+id);
  const src = kind === 'custom' ? buildCustomTest()
    : kind === 'test' ? testById.get(+id)
    : kind === 'extra' ? extraTestById.get(id)
    : chapter ? { title: `${chapter.title}: chapter practice`, questions: shuffle(chapterQuestions(chapter)) }
    : lessonById.get(+id);
  if (!src) return notFound();
  const exam = kind === 'test' || kind === 'extra' || kind === 'custom';
  run = {
    kind, id: kind === 'extra' ? id : +id, title: src.title, exam,
    backHref: { test: '#/tests', custom: '#/tests', extra: '#/extra', practice: `#/chapter/${id}`, quiz: `#/lesson/${id}` }[kind],
    questions: src.questions.map(q => ({
      ...q,
      // Keep True/False in a fixed order; shuffle everything else, because the stored correct answer is always first.
      options: [...q.options].sort().join() === 'False,True' ? ['True', 'False'] : shuffle(q.options),
    })),
    answers: [], index: 0, startedAt: Date.now(), finished: false,
    deadline: exam ? Date.now() + src.minutes * 60000 : null,
  };
  if (run.deadline) timer = setInterval(tick, 1000);
  return runPage();
}

function tick() {
  const left = run.deadline - Date.now();
  if (left <= 0) { finishRun(); alert('Time is up. Your test has been submitted.'); return; }
  const el = document.getElementById('timer');
  if (el) { el.textContent = fmtTime(left); el.classList.toggle('low', left < 5 * 60000); }
}

function runPage() {
  const r = run;
  const q = r.questions[r.index];
  const a = r.answers[r.index];
  const reveal = !r.exam && isComplete(q, a);
  const last = r.index === r.questions.length - 1;
  const blocked = !r.exam && !isComplete(q, a);

  const options = q.options.map((o, i) => {
    let cls = 'option';
    if (reveal) cls += correctAnswers(q).includes(o) ? ' correct' : a.includes(o) ? ' wrong' : '';
    else if (a?.includes(o)) cls += ' selected';
    return `<button class="${cls}" data-action="answer" data-i="${i}" ${reveal ? 'disabled' : ''}>${esc(o)}</button>`;
  }).join('');

  const nav = r.exam
    ? `<div class="dots">${r.questions.map((_, i) =>
        `<button class="dot ${i === r.index ? 'current' : ''} ${r.answers[i]?.length ? 'answered' : ''}" data-action="goto" data-i="${i}">${i + 1}</button>`).join('')}</div>`
    : bar(r.questions.filter((q, i) => isComplete(q, r.answers[i])).length, r.questions.length);

  return `<div class="runbar">
      <a class="back" href="${r.backHref}">‹ Quit</a>
      <span class="title">${r.kind === 'extra' ? '<span class="tag">Extra</span> ' : r.kind === 'custom' ? '<span class="tag custom">Custom</span> ' : ''}${esc(r.title)}</span>
      ${r.deadline ? `<span id="timer" class="timer">${fmtTime(r.deadline - Date.now())}</span>` : ''}
    </div>
    ${nav}
    <div class="muted">Question ${r.index + 1} of ${r.questions.length}</div>
    <h2 class="question">${esc(q.q)}</h2>
    ${q.answers ? `<p class="muted">Select ${q.answers.length} answers.</p>` : ''}
    <div class="options">${options}</div>
    ${reveal ? `<div class="feedback ${isCorrect(q, a) ? 'good' : 'bad'}"><b>${isCorrect(q, a) ? 'Correct.' : 'Incorrect.'}</b> ${esc(q.feedback)}</div>` : ''}
    <div class="actions">
      ${r.exam ? `<button class="btn" data-action="prev" ${r.index === 0 ? 'disabled' : ''}>‹ Previous</button>` : ''}
      ${last
        ? `<button class="btn primary" data-action="finish" ${blocked ? 'disabled' : ''}>Finish</button>`
        : `<button class="btn primary" data-action="next" ${blocked ? 'disabled' : ''}>Next ›</button>`}
    </div>`;
}

function finishRun() {
  stopTimer();
  const r = run;
  r.finished = true;
  r.minutes = Math.max(1, Math.round((Date.now() - r.startedAt) / 60000));
  const correct = r.questions.filter((q, i) => isCorrect(q, r.answers[i])).length;
  const score = pct(correct, r.questions.length);
  // Timed tests record every answer when they are submitted; an unanswered question counts as wrong.
  // Other quizzes record each answer as soon as it is given (see actions.answer).
  if (r.exam) r.questions.forEach((q, i) => record(q, isCorrect(q, r.answers[i])));
  if (r.kind === 'custom') {
    progress.custom = [...progress.custom, { at: Date.now(), score }].slice(-50);
  } else if (r.exam) {
    const scores = r.kind === 'extra' ? progress.extra : progress.tests;
    const p = scores[r.id] || { best: 0, attempts: 0 };
    scores[r.id] = { best: Math.max(p.best, score), last: score, attempts: p.attempts + 1 };
  } else if (r.kind === 'practice') {
    progress.chapters[r.id] = { best: Math.max(progress.chapters[r.id]?.best ?? 0, score) };
  } else {
    const p = progress.lessons[r.id] || {};
    progress.lessons[r.id] = { ...p, done: true, quiz: Math.max(p.quiz ?? 0, score) };
  }
  save();
  render(resultsPage(correct, score));
  window.scrollTo(0, 0);
}

function resultsPage(correct, score) {
  const r = run;
  const passed = score >= D.passPercent;
  const heading = r.exam ? (passed ? 'You passed' : 'Not a pass this time') : 'Quiz complete';
  const review = r.questions.map((q, i) => {
    const a = r.answers[i];
    const ok = isCorrect(q, a);
    return `<div class="card review">
      <div class="q">${i + 1}. ${esc(q.q)}</div>
      <p class="yours ${ok ? 'good' : 'bad'}">${ok ? '✓' : '✗'} Your answer: ${a?.length ? esc(a.join(', ')) : '<i>not answered</i>'}</p>
      ${ok ? '' : `<p class="yours good">Correct answer: ${esc(correctAnswers(q).join(', '))}</p>`}
      <p class="muted">${esc(q.feedback)}</p>
      <p class="muted">Topic: ${esc(lessonById.get(q.topic)?.title ?? '')}</p></div>`;
  }).join('');
  return `<a class="back" href="${r.backHref}">‹ Back</a>
    <h1>${heading}</h1>
    <div class="score ${passed ? 'pass' : 'fail'}">${correct} / ${r.questions.length}<small>${score}%</small></div>
    <p class="muted">The pass mark is ${D.passPercent}%. Time taken: ${r.minutes} min.</p>
    <div class="actions"><button class="btn primary" data-action="retry">${r.kind === 'custom' ? 'New custom test' : 'Try again'}</button></div>
    <h2>Review your answers</h2>${review}`;
}

// ---------- Flashcards ----------

let deck = null;
const visibleCards = () => deck.order.filter(id => !(deck.hideKnown && progress.known[id]));

function cardsPage() {
  if (!deck) deck = { order: D.flashcards.map(c => c.id), i: 0, flipped: false, hideKnown: false };
  const list = visibleCards();
  const known = D.flashcards.filter(c => progress.known[c.id]).length;
  const toolbar = `<div class="toolbar">
      <span class="muted grow">${known} of ${D.flashcards.length} cards marked as known</span>
      <label class="muted"><input type="checkbox" data-action="hideKnown" ${deck.hideKnown ? 'checked' : ''}> Hide known cards</label>
      <button class="btn" data-action="shuffle">Shuffle</button>
    </div>`;
  if (!list.length) return `<h1>Flashcards</h1>${toolbar}<p>You have marked every card as known. Untick "Hide known cards" to see them again.</p>`;

  deck.i = Math.min(deck.i, list.length - 1);
  const c = cardById.get(list[deck.i]);
  const face = deck.flipped
    ? `<div class="def">${esc(c.definition)}</div>${c.example ? `<div class="example">“${esc(c.example)}”</div>` : ''}`
    : `<div class="word">${esc(c.word)}</div><div class="muted">${esc(c.caption)}</div>`;
  return `<h1>Flashcards</h1>${toolbar}
    <div class="flash ${deck.flipped ? 'flipped' : ''}" data-action="flip">
      ${face}<div class="hint">Click the card to ${deck.flipped ? 'see the word' : 'see the meaning'}</div>
    </div>
    <p class="muted center">Card ${deck.i + 1} of ${list.length}${progress.known[c.id] ? ' · known' : ''}</p>
    <div class="actions center">
      <button class="btn" data-action="cardPrev">‹</button>
      <button class="btn" data-action="learning">Still learning</button>
      <button class="btn primary" data-action="known">I know it</button>
      <button class="btn" data-action="cardNext">›</button>
    </div>`;
}

function moveCard(step) {
  const count = visibleCards().length;
  deck.i = count ? (deck.i + step + count) % count : 0;
  deck.flipped = false;
}

// ---------- Actions and routing ----------

const actions = {
  theme() {
    const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = t;
    localStorage.setItem('lituk-theme', t);
  },
  reset() {
    if (!confirm('Delete all saved progress?')) return;
    progress.lessons = {}; progress.tests = {}; progress.known = {}; progress.chapters = {}; progress.extra = {};
    progress.review = {}; progress.custom = [];
    save(); route();
  },
  done(el) {
    const p = progress.lessons[el.dataset.id] || {};
    progress.lessons[el.dataset.id] = { ...p, done: !p.done };
    save(); route();
  },
  answer(el) {
    const q = run.questions[run.index];
    const a = run.answers[run.index] || [];
    if (!run.exam && isComplete(q, a)) return;
    const option = q.options[+el.dataset.i];
    const needed = correctAnswers(q).length;
    // With several correct answers, a click selects or deselects an option.
    // Once enough options are selected, a new click replaces the oldest selection.
    run.answers[run.index] = needed === 1 ? [option]
      : a.includes(option) ? a.filter(o => o !== option) : [...a, option].slice(-needed);
    if (!run.exam && isComplete(q, run.answers[run.index])) { record(q, isCorrect(q, run.answers[run.index])); save(); }
    render(runPage());
  },
  next() { run.index++; render(runPage()); },
  prev() { run.index--; render(runPage()); },
  goto(el) { run.index = +el.dataset.i; render(runPage()); },
  finish() {
    const missing = run.questions.length - run.answers.filter(a => a?.length).length;
    if (run.exam && missing && !confirm(`You have ${missing} unanswered question${missing > 1 ? 's' : ''}. Submit anyway?`)) return;
    finishRun();
  },
  retry() { render(startRun(run.kind, run.id)); window.scrollTo(0, 0); },
  flip() { deck.flipped = !deck.flipped; render(cardsPage()); },
  cardPrev() { moveCard(-1); render(cardsPage()); },
  cardNext() { moveCard(1); render(cardsPage()); },
  known() {
    const id = visibleCards()[deck.i];
    progress.known[id] = true; save();
    // With known cards hidden, the current card disappears and the next one takes its place.
    if (deck.hideKnown) deck.flipped = false; else moveCard(1);
    render(cardsPage());
  },
  learning() {
    const id = visibleCards()[deck.i];
    delete progress.known[id]; save();
    moveCard(1); render(cardsPage());
  },
  shuffle() { deck.order = shuffle(deck.order); deck.i = 0; deck.flipped = false; render(cardsPage()); },
  hideKnown(el) { deck.hideKnown = el.checked; deck.i = 0; deck.flipped = false; render(cardsPage()); },
};

document.addEventListener('click', e => {
  const link = e.target.closest('a[href^="#"]');
  if (link && run?.exam && !run.finished && !confirm('Leave this test? Your answers will be lost.')) {
    e.preventDefault();
    return;
  }
  const el = e.target.closest('[data-action]');
  if (el) actions[el.dataset.action](el);
});

function route() {
  stopTimer();
  const [, page, id] = location.hash.split('/');
  const name = page || 'study';
  if (!['test', 'extra-test', 'custom', 'quiz', 'practice'].includes(name)) run = null;
  const pages = {
    study: studyPage, chapter: chapterPage, lesson: lessonPage, tests: testsPage, extra: extraPage, cards: cardsPage,
    'extra-test': id => startRun('extra', id), custom: () => startRun('custom'), stats: statsPage,
    test: id => startRun('test', id), quiz: id => startRun('quiz', id), practice: id => startRun('practice', id),
  };
  render((pages[name] || notFound)(id));
  const tab = { chapter: 'study', lesson: 'study', quiz: 'study', practice: 'study', test: 'tests', custom: 'tests', stats: 'tests', 'extra-test': 'extra' }[name] || name;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
