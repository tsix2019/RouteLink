// CocoaPods numbers the objects of Pods.xcodeproj with a counter that, once it has renumbered the targets,
// can start again from zero. Objects added in the Podfile's post_install hook (React Native's Swift package
// references for Citadel) then take UUIDs already in use, the project's own included, and Xcode reports
// "The project 'Pods' is damaged" (seen only as "no such module 'Expo'" further down the log). Whether it
// happens depends only on how many objects the project has. React Native 0.87 fixes it; until SDK 57 has
// the fix (expo/expo#50794), post_install starts by handing out random UUIDs that are not taken.
const { withPodfile } = require('expo/config-plugins');

const MARKER = '# RouteLink: unique UUIDs';
const HOOK = /^( *)post_install do \|installer\|\n/m;

function addUniqueUuids(podfile) {
  if (podfile.includes(MARKER)) return podfile;
  if (!HOOK.test(podfile)) throw new Error('with-unique-pods-uuids: the Podfile has no post_install hook');
  return podfile.replace(HOOK, (line, indent) =>
    [
      line.trimEnd(),
      `${indent}  ${MARKER} for objects added from here on (plugins/with-unique-pods-uuids.js)`,
      `${indent}  installer.pods_project.define_singleton_method(:generate_uuid) do`,
      `${indent}    loop do`,
      `${indent}      uuid = SecureRandom.hex(12).upcase`,
      `${indent}      break uuid unless objects_by_uuid.key?(uuid)`,
      `${indent}    end`,
      `${indent}  end`,
      '',
    ].join('\n'),
  );
}

module.exports = function withUniquePodsUuids(config) {
  return withPodfile(config, (c) => {
    c.modResults.contents = addUniqueUuids(c.modResults.contents);
    return c;
  });
};
module.exports.addUniqueUuids = addUniqueUuids;
