// The questions Jev answers about every post. Jev only picks from these lists;
// it never writes text. Edit the wording here to retune what counts as worth reading.
export const QUESTIONS = {
  worth: {
    type: "noul",
    instructions:
      "The reader is a freelance builder of practical AI automation for small businesses and production teams. Should he read this LinkedIn post closely and consider replying?",
    criteria: {
      true: "The post is about building or using AI or automation in practice and has something concrete to respond to: a build, a test with results, numbers, a method, or a real question.",
      false: "Generic motivation, self-promotion, job or company announcements, event ads, politics, personal life updates, engagement bait, or AI hype with nothing concrete to respond to.",
    },
  },
  topic: {
    type: "choice",
    instructions: "What is the post mainly about?",
    criteria: {
      decision_models: "Classification, decision or structured-output models, including TypeSafe Jev, and using small cheap models for narrow judgments.",
      automation: "Automating business workflows with AI or code: agents, pipelines, integrations, document processing.",
      production: "TV, film or video production operations and tooling.",
      small_business: "Running a small business: admin, invoicing, tax, sales, clients.",
      ai_other: "Other AI or machine learning topics.",
      off_topic: "Not about AI, automation or small business.",
    },
  },
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
