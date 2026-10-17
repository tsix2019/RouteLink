// The latest app release from GitHub: version number and direct download links. Without it the
// buttons keep pointing at the Releases page and the version stays the one build.py wrote in.
const API = 'https://api.github.com/repos/tsix2019/RouteLink/releases/latest';
const KEY = 'rl-release';
const MAX_AGE = 60 * 60 * 1000;

async function latest() {
  try {
    const cached = JSON.parse(sessionStorage.getItem(KEY));
    if (cached && Date.now() - cached.at < MAX_AGE) return cached;
  } catch {
    // no cache
  }
  const res = await fetch(API, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) return null;
  const release = await res.json();
  const asset = (ext) => release.assets?.find((a) => a.name.endsWith(ext))?.browser_download_url;
  const data = { at: Date.now(), tag: release.tag_name, apk: asset('.apk'), ipa: asset('.ipa') };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // fine without a cache
  }
  return data;
}

export async function initRelease() {
  let data;
  try {
    data = await latest();
  } catch {
    return;
  }
  if (!data || !/^v\d/.test(data.tag || '')) return;
  for (const el of document.querySelectorAll('[data-version]')) el.textContent = data.tag;
  const android = document.querySelector('[data-dl="android"]');
  const ios = document.querySelector('[data-dl="ios"]');
  if (data.apk && android) android.href = data.apk;
  if (data.ipa && ios) ios.href = data.ipa;
}
