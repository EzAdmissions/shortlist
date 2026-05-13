const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

async function searchBrave(query) {
  const response = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`,
    {
      headers: {
        'Accept': 'application/json',
        'X-Subscription-Token': process.env.BRAVE_API_KEY,
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Brave API error: ${response.status}`);
  }

  return response.json();
}

module.exports = {
  searchBrave,
};
