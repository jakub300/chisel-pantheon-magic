#!/usr/bin/env node

const Git = require('nodegit');
const { URL } = require('url');
const helpers = require('./helpers');

const PANTHEON_KEY_PRIVATE = process.env.PANTHEON_KEY_PRIVATE;
const PANTHEON_KEY_PUBLIC = helpers.getPublicKey(PANTHEON_KEY_PRIVATE);

const PANTHEON_REMOTE_NAME = 'pantheon';
const PANTHEON_REMOTE_BRANCH = 'master';
const PANTHEON_REMOTE = `${PANTHEON_REMOTE_NAME}/${PANTHEON_REMOTE_BRANCH}`
const PANTHEON_LOCAL = `pantheon-master-`+Date.now();
const LOCAL_BRANCH = 'master';
const SIGNATURE_NAME = 'Chisel Bot';
const SIGNATURE_EMAIL = 'jakub.bogucki+chisel-bot@xfive.co';
const MESSAGE_BUILD_PREFIX = '[chisel-build]';

let repository = null;

async function main() {
  const repo = await getRepository();
  await repo.checkoutBranch(LOCAL_BRANCH, {
    checkoutStrategy: Git.Checkout.STRATEGY.FORCE,
  });
  await repo.createBranch(PANTHEON_LOCAL, await repository.getBranchCommit(PANTHEON_REMOTE), true);

  try {
    if(process.argv[2] && process.argv[2] == 'pushback') {
      await updateLocalBasedOnRemote();
    } else {
      await updateRemoteBasedOnLocal();
    }
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
    if(parents.length > 1) {
      throw new Error('When removing build commits encountered commit with more than one parent');
    }
    commit = parents[0];
  }

  if(firstNonBuildCommit) {
    await repo.createBranch(PANTHEON_LOCAL, firstNonBuildCommit, true);
  }
}

async function pushToPantheon(repo) {
  const remote = await repo.getRemote(PANTHEON_REMOTE_NAME);
  const credentials = Git.Cred.sshKeyMemoryNew(
    new URL(remote.url()).username,
    PANTHEON_KEY_PUBLIC,
    PANTHEON_KEY_PRIVATE,
    '',
  );
  return remote.push([
    `+refs/heads/${PANTHEON_LOCAL}:refs/heads/${PANTHEON_REMOTE_BRANCH}` // Plus at the beginning means force
  ], {
    callbacks: {
      credentials: () => credentials,
    }
  });
}

async function updateRemoteBasedOnLocal() {
  const repo = await getRepository();

  const headCommit = await repo.getHeadCommit();
  let branchCommit = await repo.getBranchCommit(PANTHEON_LOCAL);

  console.log(`Our branch (${LOCAL_BRANCH}) is currenrly at commit: ${headCommit.id()}`);
  console.log(`Pantheon branch (${PANTHEON_REMOTE}) is currently at commit: ${branchCommit.id()}`);

  // Git.Merge.base throws when no base found
  const base = await Git.Merge.base(repo, headCommit.id(), branchCommit.id());

  console.log(`Our and Pantheon's branches join at commit ${base}`);

  await removeBuildsFromPantheon(repo, branchCommit, base);
  branchCommit = await repo.getBranchCommit(PANTHEON_LOCAL);
  if(!base.equal(branchCommit.id())) {
    throw new Error('Patheon cleaning was not successful');
  }

  // Reset pantheon to master (it is really fast forward merge :D)
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

async function findCommitsBetween(repo, start, end) {
  const endId = end.id();
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

async function updateLocalBasedOnRemote() {
  const repo = await getRepository();

  const headCommit = await repo.getHeadCommit();
  let branchCommit = await repo.getBranchCommit(PANTHEON_LOCAL);

  console.log(`Our branch (${LOCAL_BRANCH}) is currenrly at commit: ${headCommit.id()}`);
  console.log(`Pantheon branch (${PANTHEON_REMOTE}) is currently at commit: ${branchCommit.id()}`);

  // Git.Merge.base throws when no base found
  const base = await Git.Merge.base(repo, headCommit.id(), branchCommit.id());

  console.log(`Our and Pantheon's branches join at commit ${base}`);

  if(!base.equal(headCommit.id())) {
    throw new Error('Pantheons branch must be entirely on top of ours, it is not');
  }

  const commitsToAdd = await findCommitsBetween(repo, branchCommit, headCommit);
  commitsToAdd.reverse();

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
        commit.message(),
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
        commit.message(),
        treeOid,
        [head, parents[1]],
      );
      await Git.Reset.reset(repo, await repo.getHeadCommit(), Git.Reset.TYPE.HARD);
    } else {
      throw new Error('Merge commits of more than two things are not supported');
    }
  }
  await repo.createBranch(PANTHEON_LOCAL, await repo.getHeadCommit(), true);
  await pushToPantheon(repo);
}

main().
  catch(e => console.log(e));
