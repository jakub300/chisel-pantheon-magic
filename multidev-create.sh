#!/usr/bin/env bash

set -ex

list=`terminus multidev:list $CHISEL_PANTHEON_SITE_NAME --format list`
if [ `echo "$list" | grep -Fxc $CHISEL_PANTHEON_REMOTE_BRANCH` -eq 0 ]
then
    terminus multidev:create $CHISEL_PANTHEON_SITE_NAME.dev $CHISEL_PANTHEON_REMOTE_BRANCH
else
    echo "Multidev $CHISEL_PANTHEON_REMOTE_BRANCH already exist"
fi