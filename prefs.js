// What each user wants to see. Jev answers the narrow questions (built from these prefs),
// then plain rules below turn its answers into what's shown. Shared by background and settings.

export const KINDS = {
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

export const DEFAULT_PREFS = {
  role: "someone who uses AI and automation in their work",
  topics: ["AI and machine learning in practice", "Automating everyday work", "Running a small business"],
  kinds: { built_something: true, opinion: true, question: true, news: true, promo: false, personal: false },
  redditKinds: { asking_help: true, discussion: true, showcase: true, rant: false, news: false, promo: false },
  boostWords: [],
  muteWords: [],
  highAt: 0.7,
  lowBelow: 0.4,
  lowMode: "fade", // fade | hide | show
  linkedinOn: true,
  redditOn: true,
  subreddits: [], // empty = every subreddit
  freshHours: 12,
  freshComments: 40,
};

export async function loadPrefs() {
  const { prefs = {}, dimLow } = await chrome.storage.local.get(["prefs", "dimLow"]);
  const merged = { ...DEFAULT_PREFS, ...prefs };
  merged.kinds = { ...DEFAULT_PREFS.kinds, ...(prefs.kinds || {}) };
  merged.redditKinds = { ...DEFAULT_PREFS.redditKinds, ...(prefs.redditKinds || {}) };
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

export function linkedinQuestions(prefs) {
  return {
    worth: {
      type: "noul",
      instructions: `The reader is ${prefs.role}. Should they read this LinkedIn post closely and consider replying?`,
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
        built_something: "The author shares something they built or tested, ideally with results.",
        opinion: "The author argues a view or shares lessons.",
        question: "The author asks the audience for input.",
        news: "Reports news, a launch or someone else's work.",
        promo: "Sells a product, service, course, event or job opening.",
        personal: "Personal milestone, celebration or life update.",
      },
    },
    angle: {
      type: "choice",
      instructions: "If the reader replied, which opening would fit this post best?",
      criteria: {
        ask_failures: "The post reports success without error rates, failure cases or limits, so asking about those fits.",
        ask_how: "The method is unclear, so asking how it works fits.",
        share_result: "The reader could add a related first-hand result or experience.",
        answer_question: "The author asked something the reader could answer.",
        disagree: "A claim looks overstated or wrong, so a respectful counterpoint fits.",
        none: "Nothing specific to add.",
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
    angle: {
      type: "choice",
      instructions: "If the reader replied, what kind of reply would help the poster most?",
      criteria: {
        answer_from_experience: "Answer directly from something the reader has done.",
        clarifying_question: "The post is missing key details; ask for them first.",
        approach: "Explain how the reader would approach the problem.",
        share_mistake: "Warn about a mistake the reader made or a pitfall they hit.",
        none: "No reply needed.",
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
  const kindsOn = platform === "reddit" ? prefs.redditKinds : prefs.kinds;
  const kindNames = platform === "reddit" ? REDDIT_KINDS : KINDS;
  if (kindsOn[kind] === false) { tier = "low"; reason = `${kindNames[kind] || kind}: turned off`; }
  const mute = prefs.muteWords.find((w) => w && lower.includes(w.toLowerCase()));
  if (mute) { tier = "low"; reason = `muted word "${mute}"`; }
  const boost = prefs.boostWords.find((w) => w && lower.includes(w.toLowerCase()));
  if (boost) { tier = "strong"; reason = `always show "${boost}"`; }
  return { worth, tier, reason, kind, topic: topicLabel(prefs, answers.topic.choice), angle: answers.angle.choice, lowMode: prefs.lowMode };
}
