-- Remove media/book/social junk mistakenly saved as competitions.
-- Safe to run multiple times.

DELETE FROM competitions
WHERE
  link ILIKE '%spotify.com%'
  OR link ILIKE '%open.spotify.com%'
  OR link ILIKE '%goodreads.com%'
  OR link ILIKE '%imdb.com%'
  OR link ILIKE '%wattpad.com%'
  OR link ILIKE '%letterboxd.com%'
  OR link ILIKE '%soundcloud.com%'
  OR link ILIKE '%pinterest.com%'
  OR link ILIKE '%youtube.com%'
  OR link ILIKE '%youtu.be%'
  OR link ILIKE '%tiktok.com%'
  OR link ILIKE '%amazon.com/dp/%'
  OR link ILIKE '%amazon.com/gp/product/%';
