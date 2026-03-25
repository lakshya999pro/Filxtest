const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = 3000;
const BASE_URL = 'https://4khdhub.dad';

app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Axios config with browser-like headers to avoid blocks
const httpClient = axios.create({
  timeout: 20000,
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Referer': 'https://4khdhub.dad/',
    'Cache-Control': 'no-cache',
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/movies?page=1&search=keyword
// Scrapes the listing page (or search results)
// ─────────────────────────────────────────────────────────────
app.get('/api/movies', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const search = req.query.search || '';

    let url;
    if (search) {
      url = `${BASE_URL}/?s=${encodeURIComponent(search)}`;
      if (page > 1) url += `&paged=${page}`;
    } else {
      url = page === 1 ? `${BASE_URL}/` : `${BASE_URL}/page/${page}/`;
    }

    const { data: html } = await httpClient.get(url);
    const $ = cheerio.load(html);

    const movies = [];
    $('a.movie-card').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const title = $el.find('.movie-card-title').text().trim();
      const meta = $el.find('.movie-card-meta').text().trim();
      const img = $el.find('img').attr('src') || '';
      const altText = $el.find('img').attr('alt') || title;

      // Collect quality badges
      const badges = [];
      $el.find('.quality-badge').each((_, b) => {
        badges.push({
          text: $(b).text().trim(),
          cls: $(b).attr('class') || ''
        });
      });

      // Collect format tags
      const formats = [];
      $el.find('.movie-card-format').each((_, f) => {
        formats.push($(f).text().trim());
      });

      if (title) {
        movies.push({ href, title, meta, img, altText, badges, formats });
      }
    });

    // Parse pagination
    const pagination = { current: page, total: 1, pages: [] };
    $('.pagination-item').each((_, el) => {
      const $el = $(el);
      const href = $el.attr('href') || '';
      const text = $el.text().trim();
      const num = parseInt(text);
      if (!isNaN(num) && num > pagination.total) pagination.total = num;
      if (!isNaN(num)) pagination.pages.push(num);
    });

    res.json({ ok: true, page, url, movies, pagination });
  } catch (err) {
    console.error('List error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/detail?url=/slug/
// Scrapes individual movie/series page
// Returns metadata + HubCloud download links only
// ─────────────────────────────────────────────────────────────
app.get('/api/detail', async (req, res) => {
  try {
    const slug = req.query.url;
    if (!slug) return res.status(400).json({ ok: false, error: 'Missing url param' });

    const fullUrl = slug.startsWith('http') ? slug : `${BASE_URL}${slug}`;
    const { data: html } = await httpClient.get(fullUrl);
    const $ = cheerio.load(html);

    // Title
    const title = $('h1.page-title').text().trim()
      || $('meta[property="og:title"]').attr('content') || '';

    // Poster
    const poster = $('.poster-image img').attr('src')
      || $('meta[property="og:image"]').attr('content') || '';

    // Tagline
    const tagline = $('.movie-tagline').first().text().trim();

    // Description — first <p> in .content-main after the metadata block
    const description = $('.content-section p.mt-4').first().text().trim()
      || $('meta[name="description"]').attr('content') || '';

    // Tags/genre badges
    const tags = [];
    $('.badge.badge-outline').each((_, el) => {
      tags.push($(el).text().trim());
    });

    // Metadata items (Director, Stars, Release, Prints, Audios)
    const metadata = {};
    $('.metadata-item').each((_, el) => {
      const label = $(el).find('.metadata-label').text().trim().replace(':', '');
      const value = $(el).find('.metadata-value').text().trim();
      if (label) metadata[label] = value;
    });

    // Trailer URL
    const trailerUrl = $('#trailer-btn').attr('data-trailer-url') || '';

    // ─── Download sections ───────────────────────────────────
    // Each .download-item has:
    //   .download-header > .flex-1 (title + badges)
    //   #content-fileXXX > .file-title, then a.btn links
    // We only keep links where the button text contains "HubCloud"
    const downloadSections = [];

    $('.download-item').each((_, item) => {
      const $item = $(item);

      // Header info: title text (strip badges)
      const headerRaw = $item.find('.download-header .flex-1').clone();
      headerRaw.find('code').remove(); // remove the badge code block
      const headerTitle = headerRaw.text().trim();

      // Size / audio / source badges inside <code>
      const badges = [];
      $item.find('.download-header code .badge').each((_, b) => {
        badges.push($(b).text().trim());
      });

      // File name
      const fileName = $item.find('.file-title').text().trim();

      // Extra tech badges in content area
      const techBadges = [];
      $item.find('[id^="content-file"] .flex.flex-wrap .badge').each((_, b) => {
        techBadges.push($(b).text().trim());
      });

      // Download links — ONLY HubCloud
      const hubcloudLinks = [];
      $item.find('a.btn').each((_, a) => {
        const $a = $(a);
        const btnText = $a.text().trim();
        const href = $a.attr('href') || '';
        if (btnText.toLowerCase().includes('hubcloud') && href) {
          hubcloudLinks.push({ label: btnText.replace(/\s+/g, ' ').trim(), url: href });
        }
      });

      if (hubcloudLinks.length > 0) {
        downloadSections.push({ headerTitle, badges, fileName, techBadges, hubcloudLinks });
      }
    });

    // "You may also like" related cards
    const related = [];
    $('.card-grid-small a.movie-card').each((_, el) => {
      const $el = $(el);
      related.push({
        href: $el.attr('href') || '',
        title: $el.find('.movie-card-title').text().trim(),
        img: $el.find('img').attr('src') || '',
        meta: $el.find('.movie-card-meta').text().trim(),
      });
    });

    res.json({
      ok: true,
      title,
      poster,
      tagline,
      description,
      tags,
      metadata,
      trailerUrl,
      downloadSections,
      related
    });
  } catch (err) {
    console.error('Detail error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Serve index.html for everything else
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.listen(PORT, () => {
  console.log(`4KHDHub scraper running on http://localhost:${PORT}`);
});
