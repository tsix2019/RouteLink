// Expo's defaults, minus folders Metro must not crawl or watch: native build output (thousands of
// files change during a Gradle/Xcode build) and worktrees of parallel sessions inside the repo.
const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

const SEP = String.raw`[\\/]`;
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, (c) => `\\${c}`);
/** Matches everything below `dir` (relative to the project), with either path separator. */
const below = (dir) =>
  new RegExp(`^${path.join(__dirname, dir).split(/[\\/]/).map(escapeRegExp).join(SEP)}${SEP}`);

const ignored = ['android', 'ios', '.claude', path.join('modules', 'routelink-native', 'android', 'build')].map(below);
const existing = config.resolver.blockList;
config.resolver.blockList = [...(Array.isArray(existing) ? existing : existing ? [existing] : []), ...ignored];

module.exports = config;
