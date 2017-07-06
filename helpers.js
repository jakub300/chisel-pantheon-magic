const forge = require('node-forge');

exports.sleep = function sleep(time) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

exports.getPublicKey = function getPublicKey(privateKeyStr) {
  const privateKey = forge.pki.privateKeyFromPem(privateKeyStr);
  const publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
  return forge.ssh.publicKeyToOpenSSH(publicKey);
}
