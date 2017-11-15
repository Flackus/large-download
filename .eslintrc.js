module.exports = {
    root: true,
    parser: 'babel-eslint',
    extends: 'gemini-testing',
    rules: {
        'comma-dangle': [ 'error', { objects: 'always-multiline' } ],
        'object-curly-spacing': [ 'error', 'always' ],
        'space-in-parens': 0,
        'space-unary-ops': [ 2, { overrides: { '!': true } } ]
    }
};
