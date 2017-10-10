#!/usr/bin/env bash

set -ex

list=`terminus multidev:list $CHISEL_PANTHEON_SITE_NAME --format list`
if [ `echo "$list" | grep -Fxc $CHISEL_PANTHEON_REMOTE_BRANCH` -eq 1 ]
then
    terminus multidev:delete --delete-branch --yes $CHISEL_PANTHEON_SITE_NAME.$CHISEL_PANTHEON_REMOTE_BRANCH
else
    echo "Multidev $CHISEL_PANTHEON_REMOTE_BRANCH not found"
fi