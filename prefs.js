// What each user wants to see. Jev answers the narrow questions (built from these prefs),
// then plain rules below turn its answers into what's shown. Shared by background and settings.

export const KINDS = {
  technique: "A technique or tool you could try",
  built_something: "Someone built or tested something",
  opinion: "Opinions and lessons",
  question: "Questions to the audience",
  news: "News and launches",
  promo: "Promotion, ads, job openings, events",
  personal: "Personal milestones",
};

export const REDDIT_KINDS = {
  asking_help: "Asking for help",
  discussion: "Discussions",
  showcase: "Showcases",
  rant: "Rants",
  news: "News and links",
  promo: "Promotion",
};

export const YOUTUBE_KINDS = {
  technique: "A technique or tool you could try",
  tutorial: "Tutorials and how-tos",
  build_demo: "Builds and demos",
  talk: "Talks, interviews, podcasts",
  commentary: "Commentary and news",
  entertainment: "Entertainment",
  promo: "Promotion and sponsored",
};

export const DEFAULT_PREFS = {
  role: "someone who uses AI and automation in their work",
  topics: ["AI and machine learning in practice", "Automating everyday work", "Running a small business"],
  kinds: { technique: true, built_something: true, opinion: true, question: true, news: true, promo: false, personal: false },
  redditKinds: { asking_help: true, discussion: true, showcase: true, rant: false, news: false, promo: false },
  youtubeKinds: { technique: true, tutorial: true, build_demo: true, talk: true, commentary: true, entertainment: false, promo: false },
  boostWords: [],
  muteWords: [],
  highAt: 0.7,
  lowBelow: 0.4,
  lowMode: "fade", // fade | hide | show
  linkedinOn: true,
  redditOn: true,
  youtubeOn: true,
  youtubeDescriptions: true, // ask YouTube for a video's description when its tile shows none
  xOn: true,
  subreddits: [], // empty = every subreddit
  freshHours: 12,
  freshComments: 40,
};

export async function loadPrefs() {
  const { prefs = {}, dimLow } = await chrome.storage.local.get(["prefs", "dimLow"]);
  const merged = { ...DEFAULT_PREFS, ...prefs };
  merged.kinds = { ...DEFAULT_PREFS.kinds, ...(prefs.kinds || {}) };
  merged.redditKinds = { ...DEFAULT_PREFS.redditKinds, ...(prefs.redditKinds || {}) };
  merged.youtubeKinds = { ...DEFAULT_PREFS.youtubeKinds, ...(prefs.youtubeKinds || {}) };
  if (!prefs.lowMode && dimLow === false) merged.lowMode = "show"; // carry over the old checkbox
  merged.topics = merged.topics.map((t) => t.trim()).filter(Boolean).slice(0, 8);
  if (!merged.topics.length) merged.topics = DEFAULT_PREFS.topics;
  return merged;
}

const topicCriteria = (prefs) => ({
  ...Object.fromEntries(prefs.topics.map((t, i) => [`t${i}`, t])),
  other: "None of the topics above.",
});

export const topicLabel = (prefs, key) => (key === "other" ? "" : (prefs.topics[Number(key.slice(1))] || "").slice(0, 32));

export function linkedinQuestions(prefs, site = "LinkedIn") {
  return {
    worth: {
      type: "noul",
      instructions: `The reader is ${prefs.role}. Should they read this ${site} post closely and consider replying?`,
      criteria: {
        true: `The post is about one of the reader's topics (${prefs.topics.join("; ")}) and has something concrete to respond to: a build, a test with results, numbers, a method, or a real question.`,
        false: "Off the reader's topics, or generic motivation, self-promotion, announcements, engagement bait, or hype with nothing concrete to respond to.",
      },
    },
    topic: { type: "choice", instructions: "Which of these topics is the post mainly about?", criteria: topicCriteria(prefs) },
    kind: {
      type: "choice",
      instructions: "What kind of post is it?",
      criteria: {
        technique: "The post teaches a specific method, tool, prompt, workflow or pattern that a reader could try themselves, with enough detail to start.",
        built_something: "The author shares something they built or tested, ideally with results.",
        opinion: "The author argues a view or shares lessons.",
        question: "The author asks the audience for input.",
        news: "Reports news, a launch or someone else's work.",
        promo: "Sells a product, service, course, event or job opening.",
        personal: "Personal milestone, celebration or life update.",
      },
    },
  };
}

export function redditQuestions(prefs) {
  return {
    answerable: {
      type: "noul",
      instructions: `The reader is ${prefs.role}. Their first-hand experience is listed in reader_experience. Is the poster asking for help, advice or an opinion that the reader could genuinely answer from that experience?`,
      criteria: {
        true: "The post asks a real question or describes a problem, and something in reader_experience directly applies to it.",
        false: "Not a request for help, or nothing in reader_experience applies, or it only asks for product recommendations, promotion or opinions on news.",
      },
    },
    topic: { type: "choice", instructions: "Which of these topics is the post mainly about?", criteria: topicCriteria(prefs) },
    kind: {
      type: "choice",
      instructions: "What kind of Reddit post is it?",
      criteria: {
        asking_help: "Asks for help, advice or how to do something.",
        discussion: "Starts a discussion or asks for opinions.",
        showcase: "Shows something the poster built or made.",
        rant: "Venting or complaining.",
        news: "Shares news or a link.",
        promo: "Promotes a product, service, survey or the poster's own business.",
      },
    },
  };
}

export function youtubeQuestions(prefs) {
  return {
    worth: {
      type: "noul",
      instructions: `The viewer is ${prefs.role}. From the title, channel and length, and whatever else is given (snippet: the text YouTube shows with the video, such as description lines or its own summary; chapters: the video's chapter titles; description: the start of the video's description), is this YouTube video likely worth their time? A title can be a joke, vague or clickbait while the video is a real tutorial or build: when the chapters or description say more than the title, judge by them. Descriptions often open with sponsor reads, course links and social links; those are the creator's ads, not what the video is about, and on their own they don't make it promotion.`,
      criteria: {
        true: `Likely substantive and about one of the viewer's topics (${prefs.topics.join("; ")}): a real tutorial, build, test, talk or analysis.`,
        false: "Off the viewer's topics, or clickbait, hype, get-rich-quick, reaction content or mostly promotion.",
      },
    },
    topic: { type: "choice", instructions: "Which of these topics is the video mainly about?", criteria: topicCriteria(prefs) },
    kind: {
      type: "choice",
      instructions: "What kind of video is it?",
      criteria: {
        technique: "Teaches a specific method, tool, prompt, workflow or pattern that the viewer could try themselves.",
        tutorial: "Teaches how to do something step by step.",
        build_demo: "Shows something being built, tested or demonstrated.",
        talk: "A talk, interview, panel or podcast.",
        commentary: "Opinion, commentary, news or reaction.",
        entertainment: "Entertainment, vlogs, challenges.",
        promo: "Mainly sells a course, product, community or service.",
      },
    },
  };
}

// Jev's answers + the user's rules -> what to show. Rules are plain code, so they always win.
export function verdict(answers, prefs, platform, text) {
  const worth = (answers.worth || answers.answerable).noul;
  const kind = answers.kind.choice;
  let tier = worth >= prefs.highAt ? "strong" : worth >= prefs.lowBelow ? "maybe" : "low";
  let reason = "";
  const lower = text.toLowerCase();
  const kindsOn = { reddit: prefs.redditKinds, youtube: prefs.youtubeKinds }[platform] || prefs.kinds;
  const kindNames = { reddit: REDDIT_KINDS, youtube: YOUTUBE_KINDS }[platform] || KINDS;
  if (kindsOn[kind] === false) { tier = "low"; reason = `${kindNames[kind] || kind}: turned off`; }
  const mute = prefs.muteWords.find((w) => w && lower.includes(w.toLowerCase()));
  if (mute) { tier = "low"; reason = `muted word "${mute}"`; }
  const boost = prefs.boostWords.find((w) => w && lower.includes(w.toLowerCase()));
  if (boost) { tier = "strong"; reason = `always show "${boost}"`; }
  return { worth, tier, reason, kind, topic: topicLabel(prefs, answers.topic.choice), lowMode: prefs.lowMode };
}

// Reddit facts: sent with every Reddit post that is scored, so the scorer can judge whether you could
// answer it. Reddit is pseudonymous: no business name, no site, nothing that reads as promotion.
export const DEFAULT_REDDIT_ABOUT = `- Replace these with true, first-hand facts about you, written for Reddit (no business names or links).
- Example: I've done my own bookkeeping as a sole trader for three years.
- Example: I built a script that validates customer tax IDs before invoices go out.`;
