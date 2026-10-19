#!/usr/bin/env node
'use strict';

// Local preview of the Pages site: node bin/serve.js [port]
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..', 'site');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const port = Number(process.argv[2]) || 8080;

http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.join(ROOT, pathname.endsWith('/') ? pathname + 'index.html' : pathname);
    if (!file.startsWith(ROOT + path.sep)) {
        res.writeHead(403).end();
        return;
    }
    fs.readFile(file, (err, content) => {
        if (err) {
            res.writeHead(404).end('Not found');
            return;
        }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(content);
    });
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
