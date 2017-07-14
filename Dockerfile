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
    php composer.phar clear-cache && \
    terminus -V


RUN cd ~/ && \
    mkdir chisel-pantheon-magic && \
    cd $_ && \
    npm install --prefix . --quiet git+https://github.com/jakub300/chisel-pantheon-magic.git && \
    cd node_modules/chisel-pantheon-magic && \
    ln -sr magic.js /usr/local/bin/chisel-pantheon-magic
