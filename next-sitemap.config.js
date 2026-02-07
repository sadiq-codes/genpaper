/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.NEXT_PUBLIC_APP_URL || 'https://genpaper.app',
  generateRobotsTxt: false, // We already have a custom robots.txt
  exclude: [
    '/api/*',
    '/dashboard',
    '/dashboard/*',
    '/editor',
    '/editor/*',
    '/settings',
    '/settings/*',
    '/projects',
    '/projects/*',
  ],
  generateIndexSitemap: false,
  outDir: 'public',
}
