FROM node:8

RUN cd ~/ && \
    mkdir chisel-pantheon-magic && \
    cd $_ && \
    npm install --prefix . --quiet git+https://github.com/jakub300/chisel-pantheon-magic.git && \
    cd node_modules/chisel-pantheon-magic && \
    ln -sr magic.js /usr/local/bin/chisel-pantheon-magic
