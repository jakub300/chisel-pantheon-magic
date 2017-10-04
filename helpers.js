const Git = require('nodegit');
const { execSync } = require('child_process');
const fs = require('fs');
const tmp = require('tmp');

tmp.setGracefulCleanup();

exports.sleep = function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

exports.exec = function(cmd) {
  return execSync(cmd, {stdio: 'inherit'})
}

exports.execGitWithKey = function(key, cmd) {
  const tmpFile = tmp.fileSync({discardDescriptor: true});
  console.log('Temp private key: ' + tmpFile.name); // TODO: remove
  fs.writeFileSync(tmpFile.name, key);
  const res = exports.exec(`GIT_SSH_COMMAND='ssh -i ${tmpFile.name} -o StrictHostKeyChecking=no' git ${cmd}`);
  tmpFile.removeCallback();
  return res;
}

exports.printConflicts = function(index) {
  // https://github.com/libgit2/libgit2/blob/95248be72fb9d685c59e6a5cd15582ddd3255e52/include/git2/index.h#L80
  // https://stackoverflow.com/a/25806452
  const GIT_IDXENTRY_STAGEMASK = 0x3000
  const GIT_IDXENTRY_STAGESHIFT = 12;
  const CONFLICT_OURS = 2;

  const conflicts = index
    .entries()
    .filter(entry => Git.Index.entryIsConflict(entry))
    .filter(entry => ((entry.flags & GIT_IDXENTRY_STAGEMASK) >> GIT_IDXENTRY_STAGESHIFT) == CONFLICT_OURS)
    .map(entry => '  '+entry.path);

  console.log(`Conflicts:\n${conflicts.join('\n')}`);
}
