const Git = require('nodegit');
const forge = require('node-forge');
const { URL } = require('url');
const { execSync } = require('child_process');

exports.sleep = function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

const publicKeyCache = new Map();
const getPublicKey = exports.getPublicKey = function getPublicKey(privateKeyStr) {
  if(!publicKeyCache.has(privateKeyStr)) {
    const privateKey = forge.pki.privateKeyFromPem(privateKeyStr);
    const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
    publicKeyCache.set(privateKeyStr, forge.ssh.publicKeyToOpenSSH(publicKey));
  }
  return publicKeyCache.get(privateKeyStr);
}

const credentialsCache = new Map();
exports.getCredentials = function(url, user, privateKey) {
  return Git.Cred.sshKeyMemoryNew(
    user,
    getPublicKey(privateKey),
    privateKey,
    '',
  )
}

exports.exec = function(cmd) {
  return execSync(cmd, {stdio: 'inherit'})
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
