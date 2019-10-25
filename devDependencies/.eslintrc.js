module.exports = {
    'extends': 'airbnb-base',
    'parserOptions': { 'ecmaVersion': 6 },
    'env': {
        'node': true,
        'es6': true
    },
    'rules': {
        'indent': ['error', 4],
        'import/no-unresolved': ['error', { ignore: ['homey'] }],
        'no-underscore-dangle': ['error', { 'allowAfterThis': true, 'allow': ['__'] }],
        'max-len': ['error', { 'code': 120 }],
        'comma-dangle': ['error', 'never'],
        'padded-blocks': ['error', { 'classes': 'always', 'blocks': 'never' }],
        'no-use-before-define': ['error', { 'functions': false, 'classes': true, 'variables': true }],
        'no-unused-vars': ['error', { vars: 'all', args: 'none', ignoreRestSiblings: true }],
        'arrow-body-style': ['warn']
    }
};