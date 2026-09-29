#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const BASE = 'https://elearningekpa.gr';
const DEFAULT_INPUT = path.join(__dirname, '..', 'public', 'programs.json');
const OUT_DIR = path.join(__dirname, '..', 'tmp', 'category-enrichment');
const args = new Set(process.argv.slice(2));
const inputArg = process.argv.find(x => x.startsWith('--input='));
const INPUT = inputArg ? path.resolve(inputArg.slice(8)) : DEFAULT_INPUT;
const FIXTURE = process.argv.find(x => x.startsWith('--fixture='));
const DRY_RUN = !args.has('--write-candidate');
const MAX_PAGES = 100;
const REQUEST_DELAY_MS = 1500;
const MAX_RETRIES = 5;
const CHECKPOINT_FILE = path.join(OUT_DIR, 'category-checkpoint.json');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function decodeHtml(s='') {
  return s.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;|&apos;/g,"'")
    .replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&nbsp;/g,' ')
    .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)));
}
function stripTags(s='') { return decodeHtml(s.replace(/<[^>]*>/g,' ')).replace(/\s+/g,' ').trim(); }
function canonicalUrl(raw) {
  try {
    const u = new URL(raw, BASE);
    u.hash=''; u.search='';
    let p = u.pathname.replace(/\/+$/,'');
    return `${u.origin.toLowerCase()}${p}`;
  } catch { return ''; }
}
function hrefs(html, prefix) {
  const out = new Set();
  const re = /href\s*=\s*["']([^"']+)["']/gi;
  let m;
  while ((m = re.exec(html))) {
    const h = decodeHtml(m[1]);
    try {
      const u = new URL(h, BASE);
      if (u.origin === BASE && u.pathname.startsWith(prefix)) out.add(canonicalUrl(u.href));
    } catch {}
  }
  return [...out];
}
function h1(html) {
  const m = html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return m ? stripTags(m[1]) : '';
}
function pageNumbers(html, pathname) {
  const nums = new Set([1]);
  const re = /href\s*=\s*["']([^"']+)["']/gi; let m;
  while ((m=re.exec(html))) {
    try {
      const u = new URL(decodeHtml(m[1]), BASE);
      if (u.pathname === pathname && u.searchParams.has('page')) {
        const n=Number(u.searchParams.get('page')); if(Number.isInteger(n)&&n>0&&n<=MAX_PAGES) nums.add(n);
      }
    } catch {}
  }
  return [...nums].sort((a,b)=>a-b);
}
async function get(url) {
  if (FIXTURE) {
    const map = JSON.parse(fs.readFileSync(path.resolve(FIXTURE.slice(10)), 'utf8'));
    if (!(url in map)) throw new Error(`Fixture missing URL: ${url}`);
    return map[url];
  }

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (REQUEST_DELAY_MS > 0) await sleep(REQUEST_DELAY_MS);

    let res;
    try {
      res = await fetch(url, {
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; EKPA-Smart-Finder-Category-Audit/1.0)',
          'accept': 'text/html,application/xhtml+xml'
        }
      });
    } catch (err) {
      if (attempt === MAX_RETRIES) throw err;
      const wait = Math.min(30000, 2000 * (2 ** (attempt - 1)));
      process.stderr.write(`Network error. Retry ${attempt}/${MAX_RETRIES} in ${wait}ms: ${url}\\n`);
      await sleep(wait);
      continue;
    }

    if (res.ok) return await res.text();

    const retryable = res.status === 403 || res.status === 429 || res.status >= 500;

    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(`${res.status} ${res.statusText}: ${url}`);
    }

    const retryAfter = Number(res.headers.get('retry-after'));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30000, 2000 * (2 ** (attempt - 1)));

    process.stderr.write(
      `${res.status} ${res.statusText}. Retry ${attempt}/${MAX_RETRIES} in ${wait}ms: ${url}\\n`
    );

    await sleep(wait);
  }

  throw new Error(`Request failed: ${url}`);
}
async function discoverCategories() {
  const first = await get(`${BASE}/categories`);
  const pages = pageNumbers(first, '/categories');
  const urls = new Set(hrefs(first, '/categories/'));
  for (const n of pages.filter(n=>n!==1)) {
    const html = await get(`${BASE}/categories?page=${n}`);
    hrefs(html, '/categories/').forEach(x=>urls.add(x));
  }
  return [...urls].sort();
}
async function scrapeCategory(categoryUrl) {
  const first = await get(categoryUrl);
  const name = h1(first);
  if (!name) throw new Error(`No H1 category name: ${categoryUrl}`);
  const u = new URL(categoryUrl);
  const pages = pageNumbers(first, u.pathname);
  const courses = new Set(hrefs(first, '/courses/'));
  for (const n of pages.filter(n=>n!==1)) {
    const html = await get(`${categoryUrl}?page=${n}`);
    hrefs(html, '/courses/').forEach(x=>courses.add(x));
  }
  return {name, url: categoryUrl, courses:[...courses].sort()};
}
function sameSet(a=[],b=[]) { return a.length===b.length && [...a].sort().every((x,i)=>x===[...b].sort()[i]); }

(async()=>{
  const original = JSON.parse(fs.readFileSync(INPUT,'utf8'));
  if (!Array.isArray(original)) throw new Error('programs.json must be an array');
  const originalJson = JSON.stringify(original);
  const byUrl = new Map();
  const duplicateDatasetUrls=[];
  for (const p of original) {
    const key=canonicalUrl(p.url || `${BASE}/courses/${p.slug||''}`);
    if (!key) continue;
    if (byUrl.has(key)) duplicateDatasetUrls.push(key);
    else byUrl.set(key,p);
  }

  const categoryUrls = await discoverCategories();

  fs.mkdirSync(OUT_DIR, {recursive:true});

  let categories = [];
  if (fs.existsSync(CHECKPOINT_FILE)) {
    try {
      const checkpoint = JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8'));
      if (Array.isArray(checkpoint.categories)) {
        categories = checkpoint.categories;
        process.stderr.write(`Loaded checkpoint: ${categories.length} categories already completed\\n`);
      }
    } catch (err) {
      process.stderr.write(`Ignoring invalid checkpoint: ${err.message}\\n`);
      categories = [];
    }
  }

  const completed = new Set(categories.map(c => canonicalUrl(c.url)));

  for (const [i,url] of categoryUrls.entries()) {
    if (completed.has(canonicalUrl(url))) {
      process.stderr.write(`Skipping completed ${i+1}/${categoryUrls.length}: ${url}\\n`);
      continue;
    }

    process.stderr.write(`Scraping ${i+1}/${categoryUrls.length}: ${url}\\n`);

    const category = await scrapeCategory(url);
    categories.push(category);
    completed.add(canonicalUrl(url));

    fs.writeFileSync(
      CHECKPOINT_FILE,
      JSON.stringify({
        generated_at: new Date().toISOString(),
        total_discovered: categoryUrls.length,
        completed: categories.length,
        categories
      }, null, 2)
    );
  }

  const scrapedMembership = new Map();
  const siteCourseUrls = new Set();
  for (const c of categories) for (const url of c.courses) {
    siteCourseUrls.add(url);
    if (!scrapedMembership.has(url)) scrapedMembership.set(url,[]);
    scrapedMembership.get(url).push(c.name);
  }

  const candidate = JSON.parse(originalJson);
  const candidateByUrl = new Map(candidate.map(p=>[canonicalUrl(p.url || `${BASE}/courses/${p.slug||''}`),p]));
  const rows=[];
  let matched=0, noSiteCategory=0, filledAreas=0, primarySingleFilled=0, conflicts=0, unchanged=0;
  for (const p of original) {
    const url=canonicalUrl(p.url || `${BASE}/courses/${p.slug||''}`);
    const scraped=[...(scrapedMembership.get(url)||[])].sort();
    const existing=Array.isArray(p.areas_of_study) ? [...new Set(p.areas_of_study)].sort() : [];
    const cp=candidateByUrl.get(url);
    let status='unchanged';
    if (!scraped.length) { noSiteCategory++; status='not_found_in_categories'; }
    else {
      matched++;
      if (!existing.length) { cp.areas_of_study=scraped; filledAreas++; status='areas_filled'; }
      else if (!sameSet(existing,scraped)) { conflicts++; status='membership_difference'; }
      if (!p.primary_area && scraped.length===1) { cp.primary_area=scraped[0]; primarySingleFilled++; status += '+primary_single_filled'; }
      if (status==='unchanged') unchanged++;
    }
    rows.push({id:p.id,slug:p.slug,title:p.title,url,existing_primary:p.primary_area||'',existing_areas:existing,scraped_areas:scraped,status});
  }

  const siteNotDataset=[...siteCourseUrls].filter(u=>!byUrl.has(u)).sort();
  const datasetNotSite=rows.filter(r=>r.status==='not_found_in_categories').map(r=>r.url);
  const summary={
    generated_at:new Date().toISOString(), input:INPUT, dry_run:DRY_RUN,
    dataset_programs:original.length, unique_dataset_urls:byUrl.size, duplicate_dataset_urls:duplicateDatasetUrls.length,
    categories_discovered:categories.length, unique_site_course_urls:siteCourseUrls.size,
    matched_programs:matched, dataset_programs_without_scraped_category:noSiteCategory,
    programs_with_areas_filled:filledAreas, primary_area_filled_only_when_single_category:primarySingleFilled,
    membership_differences_existing_vs_site:conflicts, unchanged_membership:unchanged,
    site_courses_not_in_dataset:siteNotDataset.length,
    validation:{program_count_preserved:candidate.length===original.length, ids_preserved:JSON.stringify(candidate.map(x=>x.id))===JSON.stringify(original.map(x=>x.id))}
  };

  fs.mkdirSync(OUT_DIR,{recursive:true});
  fs.writeFileSync(path.join(OUT_DIR,'category-scrape.json'),JSON.stringify(categories,null,2));
  fs.writeFileSync(path.join(OUT_DIR,'audit-report.json'),JSON.stringify({summary,site_courses_not_in_dataset:siteNotDataset,dataset_not_found_in_categories:datasetNotSite,programs:rows},null,2));
  fs.writeFileSync(path.join(OUT_DIR,'programs.enriched.candidate.json'),JSON.stringify(candidate,null,2)+'\n');
  fs.writeFileSync(path.join(OUT_DIR,'SUMMARY.txt'),Object.entries(summary).map(([k,v])=>`${k}: ${typeof v==='object'?JSON.stringify(v):v}`).join('\n')+'\n');

  if (!summary.validation.program_count_preserved || !summary.validation.ids_preserved) throw new Error('VALIDATION FAILED: identity/count changed');
  console.log(JSON.stringify(summary,null,2));
  if (DRY_RUN) console.log('\nDRY RUN: original programs.json was NOT modified.');
})();
