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
