#!/usr/bin/env node

const Git = require('nodegit');
const helpers = require('./helpers');

const PANTHEON_KEY_PRIVATE = process.env.PANTHEON_KEY_PRIVATE;
const PANTHEON_REMOTE_NAME = 'pantheon';
const PANTHEON_REMOTE_BRANCH = 'master';
const PANTHEON_REMOTE = `${PANTHEON_REMOTE_NAME}/${PANTHEON_REMOTE_BRANCH}`

const BASE_KEY_PRIVATE = process.env.BASE_KEY_PRIVATE;
const BASE_REMOTE_NAME = 'base';
const BASE_REMOTE_BRANCH = 'master';
const BASE_REMOTE = `${BASE_REMOTE_NAME}/${BASE_REMOTE_BRANCH}`

const PANTHEON_LOCAL = `pantheon-master-`+Date.now();
const LOCAL_BRANCH = 'master';
const SIGNATURE_NAME = 'Chisel Bot';
const SIGNATURE_EMAIL = 'jakub.bogucki+chisel-bot@xfive.co';
const MESSAGE_BUILD_PREFIX = '[chisel-build]';
const MESSAGE_FORCE_INCLUDES = '[chisel-force]';

let repository = null;

async function main() {
  const repo = await getRepository();
  await repo.checkoutBranch(LOCAL_BRANCH, {
    checkoutStrategy: Git.Checkout.STRATEGY.FORCE,
  });
  await fetchAll(repo);
  await repo.createBranch(PANTHEON_LOCAL, await repository.getBranchCommit(PANTHEON_REMOTE), true);

  try {
    await magic();
  } finally {
    await repo.checkoutBranch(LOCAL_BRANCH, {
      checkoutStrategy: Git.Checkout.STRATEGY.FORCE,
    });
    await Git.Reset.reset(repo, await repo.getHeadCommit(), Git.Reset.TYPE.HARD);
    await Git.Branch.delete(await repo.getBranch(PANTHEON_LOCAL));
  }
}

async function getRepository() {
  if(repository == null) {
    repository = await Git.Repository.open('.');
  }
  return repository;
}

async function removeBuildsFromPantheon(repo, commit, stopId) {
  let firstNonBuildCommit = null;
  while(commit) {
    const message = commit.message();
    if(!message.startsWith(MESSAGE_BUILD_PREFIX)) {
      console.log(`Pantheon first non build commit: ${commit.id()}`);
      firstNonBuildCommit = commit;
      break;
    }

    if(stopId.equal(commit.id())) {
      throw new Error('Reached stop commit');
    }

    const parents = await commit.getParents();
    commit = parents[0];
  }

  if(firstNonBuildCommit) {
    await repo.createBranch(PANTHEON_LOCAL, firstNonBuildCommit, true);
  }
}

async function push(repo, remoteName, remoteBranch, localBranch, privateKey, force) {
  process.stdout.write(`Pushing to ${remoteName}/${remoteBranch}... `);
  const remote = await repo.getRemote(remoteName);
  const res = await remote.push([
    `${force ? '+' : ''}refs/heads/${localBranch}:refs/heads/${remoteBranch}`,
  ], {
    callbacks: {
      credentials: (url, user) => helpers.getCredentials(url, user, privateKey),
    }
  });
  console.log('done');
  return res;
}

async function pushToPantheon(repo) {
  return push(repo, PANTHEON_REMOTE_NAME, PANTHEON_REMOTE_BRANCH, PANTHEON_LOCAL, PANTHEON_KEY_PRIVATE, true);
}

async function pushToBase(repo) {
  return push(repo, BASE_REMOTE_NAME, BASE_REMOTE_BRANCH, LOCAL_BRANCH, BASE_KEY_PRIVATE, false);
}

async function fetchAll(repo) {
  await repo.fetch(BASE_REMOTE_NAME, {
    callbacks: {
      credentials: (url, user) => helpers.getCredentials(url, user, BASE_KEY_PRIVATE),
    }
  });
  await repo.fetch(PANTHEON_REMOTE_NAME, {
    callbacks: {
      credentials: (url, user) => helpers.getCredentials(url, user, PANTHEON_KEY_PRIVATE),
    }
  });
}

async function magic() {
  const repo = await getRepository();

  let headCommit = await repo.getHeadCommit();
  let branchCommit = await repo.getBranchCommit(PANTHEON_LOCAL);

  console.log(`Our branch (${LOCAL_BRANCH}) is currenrly at commit: ${headCommit.id()}`);
  console.log(`Pantheon branch (${PANTHEON_REMOTE}) is currently at commit: ${branchCommit.id()}`);

  const headMessage = headCommit.message();
  if(headMessage.includes(MESSAGE_FORCE_INCLUDES)) {
    console.log(`Head commit has ${MESSAGE_FORCE_INCLUDES} in message, reseting Pantheon`);
    await repo.createBranch(PANTHEON_LOCAL, headCommit, true);
    branchCommit = await repo.getBranchCommit(PANTHEON_LOCAL);
    console.log(`Our copy of Pantheon's branch (${PANTHEON_REMOTE}) is currently at commit: ${branchCommit.id()}`);
  }

  // Git.Merge.base throws when no base found
  const base = await Git.Merge.base(repo, headCommit.id(), branchCommit.id());
  console.log(`Our and Pantheon's branches join at commit ${base}`);
  helpers.exec(`git log --graph --stat ${branchCommit.id()} HEAD --not ${base}^`);

  console.log('Checking if all commits on Pantheon on top of join are builds');
  await removeBuildsFromPantheon(repo, branchCommit, base);
  branchCommit = await repo.getBranchCommit(PANTHEON_LOCAL);
  if(!base.equal(branchCommit.id())) {
    console.log('Found commits that are not builds');
    const commitsToAdd = await findCommitsBetween(repo, branchCommit, base);
    commitsToAdd.reverse();
    console.log(`Attempting to move ${commitsToAdd.length} commit${commitsToAdd.length > 1 ? 's' : ''} to us`);
    await moveRemoteCommitsToBase(repo, commitsToAdd);
    console.log('Moved successfuly');
    await pushToBase(repo);
    headCommit = await repo.getHeadCommit();
  }

  // Reset pantheon to master
  await repo.createBranch(PANTHEON_LOCAL, headCommit, true);
  await repo.checkoutBranch(PANTHEON_LOCAL);

  // TODO: do real build
  require('fs').writeFileSync('./iambuild', Date.now().toString());

  const repoIndex = await repo.refreshIndex();
  await repoIndex.addAll(['iambuild'], Git.Index.ADD_OPTION.ADD_FORCE);
  await repoIndex.write();
  const treeOid = await repoIndex.writeTree();
  const author = Git.Signature.now(SIGNATURE_NAME, SIGNATURE_EMAIL);
  const newCommitId = await repo.createCommit(
    'HEAD',
    author,
    author,
    `${MESSAGE_BUILD_PREFIX} Builded!`,
    treeOid,
    [headCommit],
  );
  console.log(`Builded project commited in ${newCommitId}`)
  await pushToPantheon(repo);
}

async function findCommitsBetween(repo, start, endId) {
  const commits = [];
  let check = start;
  while(check) {
    if(check.id().equal(endId)) {
      break;
    }
    const parentsIds = check.parents();
    const parents = [];
    for(const parentId of parentsIds) {
      parents.push(await Git.Commit.lookup(repo, parentId));
    }
    // console.log(check.sha() + ' -> ' + parents.map(p => p.sha()).join(' '));
    commits.push({
      commit: check,
      parents,
    });

    check = parents[0];
  }
  return commits;
}

async function moveRemoteCommitsToBase(repo, commitsToAdd) {
  for(const { commit, parents } of commitsToAdd) {
    if(parents.length == 1) {
      // Single commit - cherry pick
      const message = commit.message();
      if(message.startsWith(MESSAGE_BUILD_PREFIX)) {
        // Skip commit that is build
        continue;
      }
      // console.log('Picking: '+parents[0].sha());
      const head = await repo.getHeadCommit();
      await Git.Cherrypick.cherrypick(repo, commit, {});
      const index = await repo.refreshIndex();
      if(index.hasConflicts()) {
        throw new Error(`Conflicts when cherrypicking ${commit.id()}`);
      }
      const treeOid = await index.writeTreeTo(repo);
      await repo.createCommit(
        'HEAD',
        commit.author(),
        Git.Signature.now(SIGNATURE_NAME, SIGNATURE_EMAIL),
        commit.message()+'\n[ci skip]',
        treeOid,
        [head],
      );
    } else if(parents.length == 2) {
      // Merge commit
      const head = await repo.getHeadCommit();
      console.log(`merging ${parents[1].id()} with ${head.id()}`);
      const index = await Git.Merge.commits(repo, head, parents[1]);
      if(index.hasConflicts()) {
        throw new Error(`Conflicts when merging ${parents[1].id()} with ${head.id()}`);
      }
      const treeOid = await index.writeTreeTo(repo);
      await repo.createCommit(
        'HEAD',
        commit.author(),
        Git.Signature.now(SIGNATURE_NAME, SIGNATURE_EMAIL),
        commit.message()+'\n[ci skip]',
        treeOid,
        [head, parents[1]],
      );
      await Git.Reset.reset(repo, await repo.getHeadCommit(), Git.Reset.TYPE.HARD);
    } else {
      throw new Error('Merge commits of more than two things are not supported');
    }
  }
}

main().
  catch(e => {
    console.log(e);
    process.exit(1);
  });
