// What the pipeline reads besides X, in one place: used by the fetchers (scripts/lib/sources.mjs) and listed
// in the Field guide.

export const HN_MIN_POINTS = 40;
export const BLUESKY_MIN_LIKES = 200;
export const BLUESKY_QUERIES = ['AI', 'LLM', 'ChatGPT', 'OpenAI', 'Anthropic', 'Claude', 'Gemini', 'AGI', 'generative AI'];
export const PAPERS_MIN_UPVOTES = 40;

// Feeds: [source id, kind, url].
export const FEEDS = [
  ['OpenAI', 'company', 'https://openai.com/news/rss.xml'],
  ['Google DeepMind', 'company', 'https://deepmind.google/blog/rss.xml'],
  ['Google AI', 'company', 'https://blog.google/technology/ai/rss/'],
  ['Hugging Face', 'company', 'https://huggingface.co/blog/feed.xml'],
  ['NVIDIA', 'company', 'https://blogs.nvidia.com/feed/'],
  ['LessWrong', 'community', 'https://www.lesswrong.com/feed.xml?view=frontpage-rss&karmaThreshold=30'],
  ['Alignment Forum', 'community', 'https://www.alignmentforum.org/feed.xml?view=frontpage-rss'],
  ['Simon Willison', 'community', 'https://simonwillison.net/atom/everything/'],
  ['Interconnects', 'community', 'https://www.interconnects.ai/feed'],
  ['Import AI', 'community', 'https://importai.substack.com/feed'],
  ['Latent Space', 'community', 'https://www.latent.space/feed'],
  ['One Useful Thing', 'community', 'https://www.oneusefulthing.org/feed'],
  ['AI Snake Oil', 'community', 'https://www.aisnakeoil.com/feed'],
  ['Gary Marcus', 'community', 'https://garymarcus.substack.com/feed'],
  ['TechCrunch', 'news', 'https://techcrunch.com/category/artificial-intelligence/feed/'],
  ['The Verge', 'news', 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml'],
];


// AI stocks: [symbol, name, what it's about, as a pattern to tie it to topics].
export const STOCKS = [
  ['NVDA', 'Nvidia', 'nvidia|chip|gpu|datacenter|compute'],
  ['MSFT', 'Microsoft', 'microsoft|openai|chatgpt|copilot|azure'],
  ['GOOGL', 'Alphabet', 'google|gemini|deepmind|waymo|genie'],
  ['META', 'Meta', 'meta|llama|muse'],
  ['AMZN', 'Amazon', 'amazon|aws'],
  ['TSM', 'TSMC', 'chip|datacenter|china'],
  ['AVGO', 'Broadcom', 'chip|datacenter'],
  ['AMD', 'AMD', 'amd|chip|gpu'],
  ['ORCL', 'Oracle', 'oracle|datacenter|compute'],
  ['CRWV', 'CoreWeave', 'coreweave|neocloud|compute'],
  ['NBIS', 'Nebius', 'nebius|neocloud|compute'],
  ['PLTR', 'Palantir', 'palantir|enterprise'],
  ['TSLA', 'Tesla', 'tesla|robotaxi|optimus|humanoid'],
];

