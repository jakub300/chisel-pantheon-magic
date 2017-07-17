FROM node:8

RUN cd ~/ && \
    mkdir terminus && \
    cd $_ && \
    apt-get update && \
    apt-get install -y php5-cli && \
    rm -rf /var/lib/apt/lists/* && \
    php -v && \
    php -r "copy('https://getcomposer.org/installer', 'composer-setup.php');" && \
    php composer-setup.php && \
    php -r "unlink('composer-setup.php');" && \
    curl -O https://raw.githubusercontent.com/pantheon-systems/terminus-installer/master/builds/installer.phar && \
    php installer.phar install && \
    php composer.phar clear-cache
#    terminus -V
# Terminus run temporarily disabled https://github.com/pantheon-systems/terminus/issues/1739


WORKDIR /root

ADD . /root/chisel-pantheon-magic

RUN cd /root/chisel-pantheon-magic && \
    npm install && \
    ln -sr magic.js /usr/local/bin/chisel-pantheon-magic

WORKDIR /
