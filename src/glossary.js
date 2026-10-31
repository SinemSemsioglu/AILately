// The atlas's vocabulary: what the six groups are and what the mood words mean. Used for inline definitions
// (dotted-underlined terms with a hover card) and the Field guide page.

export const GROUPS = {
  frontier: {
    name: 'Frontier Labs',
    short: 'The labs building the largest models, and the people who run them.',
    long: 'The companies training the most capable general models (OpenAI, Anthropic, Google DeepMind, Meta, xAI, Mistral, Qwen, DeepSeek…) and their leaders. Launches and company news start here.',
  },
  research: {
    name: 'Research',
    short: 'Researchers, academics and research labs, including robotics.',
    long: 'People who publish: university and industry researchers, research organisations and conferences. Robotics research is part of this group.',
  },
  builders: {
    name: 'Builders & Open Source',
    short: 'Engineers, open-source projects and the companies making AI tools and infrastructure.',
    long: 'People shipping things with AI: developer tools, open-weight models, inference and infrastructure companies, and the engineers who use and write about them.',
  },
  creative: {
    name: 'Creative AI',
    short: 'Image, video, music and design tools, and the people making them.',
    long: 'Generative media: the companies behind image, video, voice and music models, and the artists and makers working with them.',
  },
  discourse: {
    name: 'Commentary & Discourse',
    short: 'Investors, journalists, writers, podcasters, educators and AI news accounts.',
    long: 'The people who explain, debate and amplify: investors, reporters, newsletter writers, podcasters, educators and aggregator accounts. Often the loudest group by volume.',
  },
  safety: {
    name: 'Safety & Policy',
    short: 'Alignment, safety, governance and policy: researchers, organisations, advocates and critics.',
    long: 'People working on making AI go well, or arguing about whether it will: alignment and interpretability researchers, evaluation and policy organisations, advocates and critics.',
  },
};

export const TERMS = {
  hopeful: {
    name: 'Hopeful',
    short: 'Posts expect good consequences from the development.',
  },
  worried: {
    name: 'Worried',
    short: 'Posts expect harm or risk from the development.',
  },
  believers: {
    name: 'Believers',
    short: 'Posts treat the development as real and significant, not hype.',
  },
  sceptics: {
    name: 'Sceptics',
    short: 'Posts doubt the claims or think it is overhyped.',
  },
  divided: {
    name: 'Divided',
    short: 'Opinion is split: some posts are hopeful, others worried, rather than everyone agreeing.',
  },
  mixed: {
    name: 'Mixed',
    short: 'No clear lean either way: posts are neutral, or their stances balance out.',
  },
  outlook: {
    name: 'Outlook',
    short: 'Worried ↔ hopeful: whether posts expect AI’s consequences to be bad or good.',
  },
  belief: {
    name: 'Belief',
    short: 'Sceptics ↔ believers: whether posts think a development is real or overhyped.',
  },
  division: {
    name: 'Division',
    short: 'Agreed ↔ divided: how split the outlook is among the posts.',
  },
};

// A term's inline markup: dotted underline, definition on hover (see installDefinitions).
export function term(key, text) {
  const def = GROUPS[key]?.short ?? TERMS[key]?.short;
  const label = text ?? GROUPS[key]?.name ?? TERMS[key]?.name ?? key;
  return def ? `<span class="term" tabindex="0" data-term="${key}">${label}</span>` : label;
}

// Mood in words, with each word defined inline.
export function moodWords(m) {
  // A topic where no post took a stance (news and links only) has no mood to describe.
  if (m.scored === 0) return '<span class="no-stance">no stance</span>';
  const words = [];
  if (m.outlook > 0.35) words.push('hopeful');
  else if (m.outlook < -0.35) words.push('worried');
  if (m.belief > 0.35) words.push('believers');
  else if (m.belief < -0.35) words.push('sceptics');
  if (m.division > 0.6) words.push('divided');
  if (!words.length) words.push('mixed');
  return words.map((w) => term(w, w)).join(' · ');
}

// One shared hover card for every .term on the page.
export function installDefinitions(root = document) {
  const card = document.createElement('div');
  card.className = 'term-card';
  card.hidden = true;
  document.body.appendChild(card);
  const show = (el) => {
    const key = el.dataset.term;
    const g = GROUPS[key];
    const t = TERMS[key];
    card.innerHTML = `<b>${g?.name ?? t?.name}</b><span>${g?.short ?? t?.short}</span><a href="./field-guide.html#${key}">Field guide →</a>`;
    card.hidden = false;
    const r = el.getBoundingClientRect();
    const x = Math.min(window.innerWidth - card.offsetWidth - 12, Math.max(12, r.left));
    card.style.left = `${x}px`;
    card.style.top = `${r.bottom + window.scrollY + 6}px`;
  };
  let hideTimer = null;
  const hide = () => (hideTimer = setTimeout(() => (card.hidden = true), 150));
  root.addEventListener('pointerover', (e) => {
    const el = e.target.closest('.term');
    if (el) clearTimeout(hideTimer), show(el);
  });
  root.addEventListener('pointerout', (e) => e.target.closest('.term') && hide());
  root.addEventListener('focusin', (e) => e.target.closest('.term') && show(e.target.closest('.term')));
  root.addEventListener('focusout', hide);
  card.addEventListener('pointerover', () => clearTimeout(hideTimer));
  card.addEventListener('pointerout', hide);
}
