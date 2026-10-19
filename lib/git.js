'use strict';

const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const fs = require('node:fs');

const execFileAsync = promisify(execFile);

async function git(gitDir, args, options = {}) {
    const { stdout } = await execFileAsync('git', ['--git-dir', gitDir, ...args], { maxBuffer: 256 * 1024 * 1024, ...options });
    return stdout;
}

/**
 * Keeps a bare mirror of the repository in the cache directory, so a run only
 * fetches what is new.
 */
async function syncMirror(url, gitDir) {
    if (fs.existsSync(gitDir)) {
        await git(gitDir, ['fetch', '--quiet', '--prune', '--prune-tags', '--force', 'origin', '+refs/heads/*:refs/heads/*', '+refs/tags/*:refs/tags/*']);
    } else {
        await execFileAsync('git', ['clone', '--quiet', '--bare', url, gitDir], { maxBuffer: 16 * 1024 * 1024 });
    }
}

/**
 * Release tags with the commit they point at and that commit's date. Only
 * plain x.y.z versions count; prereleases would put a zigzag in every chart.
 */
async function listReleaseTags(gitDir) {
    const format = [
        '%(refname:short)',
        '%(if)%(*objectname)%(then)%(*objectname)%(else)%(objectname)%(end)',
        '%(if)%(*objectname)%(then)%(*committerdate:iso-strict)%(else)%(committerdate:iso-strict)%(end)'
    ].join('%09');
    const output = await git(gitDir, ['for-each-ref', '--format=' + format, 'refs/tags']);
    return output
        .split('\n')
        .filter(Boolean)
        .map(line => {
            const [ref, commit, date] = line.split('\t');
            return { ref, commit, date };
        })
        .filter(tag => /^v?\d+\.\d+\.\d+$/.test(tag.ref) && tag.date);
}

async function headCommit(gitDir) {
    const output = await git(gitDir, ['log', '-1', '--format=%H%x09%cI', 'HEAD']);
    const [commit, date] = output.trim().split('\t');
    return { ref: 'HEAD', commit, date };
}

/**
 * Every blob in a commit's tree as {path, oid, size}.
 */
async function listTree(gitDir, commit) {
    const output = await git(gitDir, ['ls-tree', '-r', '-l', '-z', '--full-tree', commit]);
    const entries = [];
    for (const record of output.split('\0')) {
        if (!record) {
            continue;
        }
        const tab = record.indexOf('\t');
        const [, type, oid, size] = record.slice(0, tab).split(/\s+/);
        if (type === 'blob') {
            entries.push({ path: record.slice(tab + 1), oid, size: Number(size) });
        }
    }
    return entries;
}

/**
 * Reads many blobs through one `git cat-file --batch` process.
 *
 * @returns {Promise<Map<string, Buffer>>} oid -> content
 */
function readBlobs(gitDir, oids) {
    return new Promise((resolve, reject) => {
        const child = spawn('git', ['--git-dir', gitDir, 'cat-file', '--batch'], { stdio: ['pipe', 'pipe', 'inherit'] });
        const chunks = [];
        child.stdout.on('data', chunk => chunks.push(chunk));
        child.on('error', reject);
        child.on('close', code => {
            if (code !== 0) {
                return reject(new Error(`git cat-file exited with ${code}`));
            }
            const buffer = Buffer.concat(chunks);
            const blobs = new Map();
            let offset = 0;
            while (offset < buffer.length) {
                const newline = buffer.indexOf(0x0a, offset);
                const [oid, type, size] = buffer.subarray(offset, newline).toString().split(' ');
                if (type === 'missing') {
                    offset = newline + 1;
                    continue;
                }
                const start = newline + 1;
                const end = start + Number(size);
                blobs.set(oid, buffer.subarray(start, end));
                offset = end + 1;
            }
            resolve(blobs);
        });
        child.stdin.end(oids.join('\n') + '\n');
    });
}

module.exports = { syncMirror, listReleaseTags, headCommit, listTree, readBlobs };
