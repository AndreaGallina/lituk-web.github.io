'use strict';

const D = window.DATA;
const $app = document.getElementById('app');

// Progress is kept in the browser's localStorage, so it survives reloads on the same browser.
const KEY = 'lituk-progress-v1';
const progress = Object.assign({ lessons: {}, tests: {}, known: {}, chapters: {} }, JSON.parse(localStorage.getItem(KEY) || '{}'));
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

function testsPage() {
  const tests = D.tests.map(t => {
    const p = progress.tests[t.id];
    const passed = p && p.best >= D.passPercent;
    return `<a class="card" href="#/test/${t.id}">
      <div class="grow"><div class="title">${esc(t.title)}</div>
        <div class="muted">${p ? `Best ${p.best}% · last ${p.last}% · ${p.attempts} attempt${p.attempts > 1 ? 's' : ''}` : 'Not taken yet'}</div></div>
      ${p ? `<span class="badge ${passed ? 'pass' : 'fail'}">${passed ? 'Pass' : 'Fail'}</span>` : ''}</a>`;
  }).join('');
  return `<h1>Practice tests</h1>
    <p class="muted">Each test has 24 questions and a 45-minute time limit, like the real test. You need ${D.passPercent}% (18 correct answers) to pass.</p>
    ${tests}`;
}

// ---------- Question runner (lesson quizzes, chapter practice and practice tests) ----------
// A lesson quiz or chapter practice shows the right answer after each question.
// A practice test ("exam") has a timer and only shows answers at the end.

let run = null;
let timer = null;
const stopTimer = () => { clearInterval(timer); timer = null; };

function startRun(kind, id) {
  const chapter = kind === 'practice' && chapterById.get(+id);
  const src = kind === 'test' ? testById.get(+id)
    : chapter ? { title: `${chapter.title}: chapter practice`, questions: shuffle(chapterQuestions(chapter)) }
    : lessonById.get(+id);
  if (!src) return notFound();
  run = {
    kind, id: +id, title: src.title, exam: kind === 'test',
    backHref: { test: '#/tests', practice: `#/chapter/${id}`, quiz: `#/lesson/${id}` }[kind],
    questions: src.questions.map(q => ({
      ...q,
      // Keep True/False in a fixed order; shuffle everything else, because the stored correct answer is always first.
      options: q.options.join() === 'False,True' ? ['True', 'False'] : shuffle(q.options),
    })),
    answers: [], index: 0, startedAt: Date.now(), finished: false,
    deadline: kind === 'test' ? Date.now() + src.minutes * 60000 : null,
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
  const reveal = !r.exam && a !== undefined;
  const last = r.index === r.questions.length - 1;
  const blocked = !r.exam && a === undefined;

  const options = q.options.map((o, i) => {
    let cls = 'option';
    if (reveal) cls += o === q.answer ? ' correct' : o === a ? ' wrong' : '';
    else if (o === a) cls += ' selected';
    return `<button class="${cls}" data-action="answer" data-i="${i}" ${reveal ? 'disabled' : ''}>${esc(o)}</button>`;
  }).join('');

  const nav = r.exam
    ? `<div class="dots">${r.questions.map((_, i) =>
        `<button class="dot ${i === r.index ? 'current' : ''} ${r.answers[i] !== undefined ? 'answered' : ''}" data-action="goto" data-i="${i}">${i + 1}</button>`).join('')}</div>`
    : bar(r.answers.length, r.questions.length);

  return `<div class="runbar">
      <a class="back" href="${r.backHref}">‹ Quit</a>
      <span class="title">${esc(r.title)}</span>
      ${r.deadline ? `<span id="timer" class="timer">${fmtTime(r.deadline - Date.now())}</span>` : ''}
    </div>
    ${nav}
    <div class="muted">Question ${r.index + 1} of ${r.questions.length}</div>
    <h2 class="question">${esc(q.q)}</h2>
    <div class="options">${options}</div>
    ${reveal ? `<div class="feedback ${a === q.answer ? 'good' : 'bad'}"><b>${a === q.answer ? 'Correct.' : 'Incorrect.'}</b> ${esc(q.feedback)}</div>` : ''}
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
  const correct = r.questions.filter((q, i) => r.answers[i] === q.answer).length;
  const score = pct(correct, r.questions.length);
  if (r.kind === 'test') {
    const p = progress.tests[r.id] || { best: 0, attempts: 0 };
    progress.tests[r.id] = { best: Math.max(p.best, score), last: score, attempts: p.attempts + 1 };
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
    const ok = a === q.answer;
    return `<div class="card review">
      <div class="q">${i + 1}. ${esc(q.q)}</div>
      <p class="yours ${ok ? 'good' : 'bad'}">${ok ? '✓' : '✗'} Your answer: ${a === undefined ? '<i>not answered</i>' : esc(a)}</p>
      ${ok ? '' : `<p class="yours good">Correct answer: ${esc(q.answer)}</p>`}
      <p class="muted">${esc(q.feedback)}</p></div>`;
  }).join('');
  return `<a class="back" href="${r.backHref}">‹ Back</a>
    <h1>${heading}</h1>
    <div class="score ${passed ? 'pass' : 'fail'}">${correct} / ${r.questions.length}<small>${score}%</small></div>
    <p class="muted">The pass mark is ${D.passPercent}%. Time taken: ${r.minutes} min.</p>
    <div class="actions"><button class="btn primary" data-action="retry">Try again</button></div>
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
    progress.lessons = {}; progress.tests = {}; progress.known = {}; progress.chapters = {};
    save(); route();
  },
  done(el) {
    const p = progress.lessons[el.dataset.id] || {};
    progress.lessons[el.dataset.id] = { ...p, done: !p.done };
    save(); route();
  },
  answer(el) {
    if (!run.exam && run.answers[run.index] !== undefined) return;
    run.answers[run.index] = run.questions[run.index].options[+el.dataset.i];
    render(runPage());
  },
  next() { run.index++; render(runPage()); },
  prev() { run.index--; render(runPage()); },
  goto(el) { run.index = +el.dataset.i; render(runPage()); },
  finish() {
    const missing = run.questions.length - run.answers.filter(a => a !== undefined).length;
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
  if (!['test', 'quiz', 'practice'].includes(name)) run = null;
  const pages = {
    study: studyPage, chapter: chapterPage, lesson: lessonPage, tests: testsPage, cards: cardsPage,
    test: id => startRun('test', id), quiz: id => startRun('quiz', id), practice: id => startRun('practice', id),
  };
  render((pages[name] || notFound)(id));
  const tab = { chapter: 'study', lesson: 'study', quiz: 'study', practice: 'study', test: 'tests' }[name] || name;
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  window.scrollTo(0, 0);
}

window.addEventListener('hashchange', route);
route();
