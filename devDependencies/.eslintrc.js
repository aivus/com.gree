module.exports = {
    "extends": "airbnb-base",
    "parserOptions": { "ecmaVersion": 6 },
    "env": {
        "node": true,
        "es6": true
    },
    "rules": {
        "indent": ["error", 4],
        "import/no-unresolved": ["error", { ignore: ['homey'] }],
        "no-underscore-dangle": ["error", { "allowAfterThis": true }],
        "max-len": ["error", { "code": 120 }],
        "comma-dangle": ["error", "never"],
        "padded-blocks": ["error", { "classes": "always", "blocks": "never" }]
    }
};