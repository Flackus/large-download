'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const gimmePort = require('gimme-port-as-promised');

// dd if=/dev/urandom of=large-file bs=100M count=1
// GitHub's file size limit is 100MB
const FILE_FIXTURE = fs.readFileSync(path.resolve(__dirname, 'large-file'));
const SIZE = FILE_FIXTURE.length;

let server;

function handler(req, res) {
    const url = req.url;

    if (url === '/404') {
        res.statusCode = 404;
        return res.end();
    }

    res.setHeader('content-length', url === '/size-mismatch' ? SIZE * 2 : SIZE);
    res.statusCode = 200;

    if (url === '/slow') {
        setTimeout(() => res.end(FILE_FIXTURE), 1000);
    } else {
        res.end(FILE_FIXTURE);
    }
}

module.exports = {
    start() {
        return gimmePort().then(port => {
            return new Promise(resolve => {
                server = http
                    .createServer(handler)
                    .listen(port, resolve(port));
            });
        });
    },
    stop() {
        server && server.close();
    },
};
