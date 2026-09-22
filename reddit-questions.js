// What Jev asks about each Reddit post. Goal on Reddit is different from LinkedIn:
// find people asking for help that the reader can answer from first-hand experience.
export const REDDIT_QUESTIONS = {
  answerable: {
    type: "noul",
    instructions:
      "The reader's first-hand experience is listed in reader_experience. Is the poster asking for help, advice or an opinion that the reader could genuinely answer from that experience?",
    criteria: {
      true: "The post asks a real question or describes a problem, and something in reader_experience directly applies to it.",
      false: "Not a request for help, or nothing in reader_experience applies, or it only asks for product recommendations, promotion or opinions on news.",
    },
  },
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
  topic: {
    type: "choice",
    instructions: "What is the post mainly about?",
    criteria: {
      automation: "Automating work with scripts, AI, n8n, Zapier or similar.",
      ai_tools: "AI models, LLMs, classifiers and how to use them.",
      small_business: "Running a small business: invoicing, tax, clients, pricing, email, admin.",
      croatia: "Practical life or business in Croatia.",
      dev: "Software development in general.",
      off_topic: "None of the above.",
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
