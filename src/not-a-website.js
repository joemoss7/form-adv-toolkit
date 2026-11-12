// Domains that are never an adviser's own website: advisor directories and networks, review and
// lead sites, regulators, social pages, site builders, blog and podcast hosts. Form ADV lists every
// web address a firm uses (Item 1.I), so these are skipped when picking a firm's website.
export const NOT_A_WEBSITE = new RegExp(`(^|\\.)(${[
  // Advisor directories, networks and lead sites
  "feeonlynetwork", "napfa", "xyplanningnetwork", "garrettplanningnetwork", "letsmakeaplan", "plannersearch", "fpanet", "cfp",
  "paladinregistry", "indyfin", "zoefin", "zoefinancial", "wiseradvisor", "smartasset", "wealthtender", "advisorcheck", "brightscope",
  "flatfeeadvisors", "advicepay", "unbiased", "nerdwallet", "investopedia", "forbes", "barrons", "kitces", "dfa-advisors",
  "findanadvisor", "advisorfinder", "fiduciaryadvisors", "retirementadvisorpro", "theadvisorcenter", "advisor-match", "wealthramp",
  // Regulators
  "brokercheck", "adviserinfo", "finra", "sec", "nasaa",
  // Social, link and site-builder pages
  "linkedin", "facebook", "twitter", "x", "instagram", "youtube", "tiktok", "vimeo", "threads", "pinterest", "reddit", "yelp",
  "google", "goo", "bit", "linktr", "wix", "wixsite", "squarespace", "godaddysites", "wordpress", "weebly", "business", "site123", "carrd",
  "alignable", "nextdoor", "bsky", "truthsocial", "angel", "crunchbase", "glassdoor", "indeed", "seekingalpha", "qq",
  // Blogs, newsletters and podcast hosts
  "substack", "medium", "blogspot", "beehiiv", "apple", "spotify", "podbean", "buzzsprout", "libsyn", "soundcloud", "anchor",
  "simplecast", "transistor", "captivate", "spreaker", "iheart", "audible", "amazon", "stitcher", "pod", "podcasts", "spoti", "naver", "yahoo", "msn",
].join("|")})\\.[a-z.]+$`);
