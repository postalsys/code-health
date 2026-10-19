'use strict';

const { parse } = require('@babel/parser');

// Per-function maintainability index on the 0..100 scale Visual Studio uses:
// MI = max(0, (171 - 5.2 ln(V) - 0.23 CC - 16.2 ln(SLOC)) * 100 / 171)
function maintainabilityIndex(volume, cyclomatic, sloc) {
    const mi = 171 - 5.2 * Math.log(Math.max(volume, 1)) - 0.23 * cyclomatic - 16.2 * Math.log(Math.max(sloc, 1));
    return Math.max(0, (mi * 100) / 171);
}

const FUNCTION_TYPES = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'ObjectMethod', 'ClassMethod', 'ClassPrivateMethod']);

const BRANCH_TYPES = new Set([
    'IfStatement',
    'ConditionalExpression',
    'ForStatement',
    'ForInStatement',
    'ForOfStatement',
    'WhileStatement',
    'DoWhileStatement',
    'CatchClause',
    // a default parameter is a branch the same way `x = x || d` is
    'AssignmentPattern'
]);

const LOGICAL_ASSIGNMENT = new Set(['&&=', '||=', '??=']);

// Token labels that name a value rather than an operation
const OPERAND_LABELS = new Set([
    'name',
    'num',
    'bigint',
    'decimal',
    'string',
    'regexp',
    'template',
    'privateName',
    '#name',
    'jsxName',
    'jsxText',
    'true',
    'false',
    'null',
    'this',
    'super'
]);

const SKIP_KEYS = new Set(['loc', 'start', 'end', 'extra', 'range', 'leadingComments', 'trailingComments', 'innerComments', 'comments', 'tokens']);

function isBranch(node) {
    if (BRANCH_TYPES.has(node.type)) {
        return true;
    }
    switch (node.type) {
        case 'SwitchCase':
            return node.test !== null;
        case 'LogicalExpression':
            return true;
        case 'AssignmentExpression':
            return LOGICAL_ASSIGNMENT.has(node.operator);
        case 'OptionalMemberExpression':
        case 'OptionalCallExpression':
            return node.optional === true;
    }
    return false;
}

function keyName(key) {
    if (!key) {
        return null;
    }
    switch (key.type) {
        case 'Identifier':
            return key.name;
        case 'PrivateName':
            return '#' + key.id.name;
        case 'StringLiteral':
        case 'NumericLiteral':
            return String(key.value);
    }
    return null;
}

function functionName(node, parent) {
    if (node.id && node.id.name) {
        return node.id.name;
    }
    if (node.key) {
        return keyName(node.key) || '<computed>';
    }
    if (parent) {
        if (parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
            return parent.id.name;
        }
        if ((parent.type === 'ObjectProperty' || parent.type === 'ClassProperty') && parent.value === node) {
            return keyName(parent.key) || '<computed>';
        }
        if (parent.type === 'AssignmentExpression' && parent.right === node) {
            const left = parent.left;
            if (left.type === 'Identifier') {
                return left.name;
            }
            if (left.type === 'MemberExpression') {
                return keyName(left.property) || '<computed>';
            }
        }
    }
    return '<anonymous>';
}

function parseSource(source, filename) {
    const typescript = /\.[cm]?tsx?$/.test(filename);
    return parse(source, {
        sourceType: 'unambiguous',
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        allowImportExportEverywhere: true,
        allowUndeclaredExports: true,
        errorRecovery: true,
        tokens: true,
        plugins: typescript ? ['typescript', 'decorators-legacy'] : ['jsx', 'decorators-legacy']
    });
}

function halsteadVolume(counts) {
    const n = counts.operators.size + counts.operands.size;
    const N = counts.totalOperators + counts.totalOperands;
    return n > 1 ? N * Math.log2(n) : 0;
}

function newCounts() {
    return { operators: new Set(), operands: new Set(), totalOperators: 0, totalOperands: 0, lines: new Set() };
}

/**
 * Measures one source file. The code outside any function counts as one
 * extra unit (`<module>`), so a file that is all top-level statements is not
 * invisible.
 *
 * @returns {{loc: number, sloc: number, functions: Array<{name: string, line: number, cc: number, sloc: number, volume: number, mi: number}>}}
 */
function measureFile(source, filename) {
    const ast = parseSource(source, filename);

    // units[0] is the module-level code
    const units = [{ name: '<module>', line: 1, start: 0, end: source.length, depth: 0, cc: 1 }];

    const walk = (node, parent, owner, depth) => {
        if (FUNCTION_TYPES.has(node.type)) {
            const unit = {
                name: functionName(node, parent),
                line: node.loc.start.line,
                start: node.start,
                end: node.end,
                depth: depth + 1,
                cc: 1
            };
            units.push(unit);
            owner = unit;
            depth++;
        } else if (isBranch(node)) {
            owner.cc++;
        }

        for (const key of Object.keys(node)) {
            if (SKIP_KEYS.has(key)) {
                continue;
            }
            const value = node[key];
            if (Array.isArray(value)) {
                for (const child of value) {
                    if (child && typeof child.type === 'string') {
                        walk(child, node, owner, depth);
                    }
                }
            } else if (value && typeof value.type === 'string') {
                walk(value, node, owner, depth);
            }
        }
    };
    walk(ast.program, null, units[0], 0);

    const tokens = ast.tokens.filter(token => token.type !== 'CommentLine' && token.type !== 'CommentBlock' && token.type.label !== 'eof');

    // Each token belongs to the innermost function containing it. Units are
    // visited outer first, so a nested function overwrites its parent's claim.
    const owners = new Int32Array(tokens.length);
    const order = units.map((unit, index) => index).sort((a, b) => units[a].depth - units[b].depth);
    for (const index of order) {
        if (index === 0) {
            continue;
        }
        const unit = units[index];
        let low = 0;
        let high = tokens.length;
        while (low < high) {
            const mid = (low + high) >>> 1;
            if (tokens[mid].start < unit.start) {
                low = mid + 1;
            } else {
                high = mid;
            }
        }
        for (let i = low; i < tokens.length && tokens[i].end <= unit.end; i++) {
            owners[i] = index;
        }
    }

    const counts = units.map(() => newCounts());
    const fileCodeLines = new Set();
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i];
        const label = token.type.label;
        const unitCounts = counts[owners[i]];
        if (OPERAND_LABELS.has(label)) {
            unitCounts.operands.add(label + ':' + token.value);
            unitCounts.totalOperands++;
        } else {
            unitCounts.operators.add(label);
            unitCounts.totalOperators++;
        }
        for (let line = token.loc.start.line; line <= token.loc.end.line; line++) {
            unitCounts.lines.add(line);
            fileCodeLines.add(line);
        }
    }

    const functions = [];
    for (let i = 0; i < units.length; i++) {
        const unit = units[i];
        const sloc = counts[i].lines.size;
        if (i === 0 && sloc === 0) {
            continue;
        }
        const volume = halsteadVolume(counts[i]);
        functions.push({
            name: unit.name,
            line: unit.line,
            cc: unit.cc,
            sloc,
            volume: Math.round(volume),
            mi: Math.round(maintainabilityIndex(volume, unit.cc, sloc) * 10) / 10
        });
    }

    let loc = 0;
    for (const line of source.split(/\r?\n/)) {
        if (line.trim()) {
            loc++;
        }
    }

    return { loc, sloc: fileCodeLines.size, functions, errors: ast.errors ? ast.errors.length : 0 };
}

module.exports = { measureFile, maintainabilityIndex };
