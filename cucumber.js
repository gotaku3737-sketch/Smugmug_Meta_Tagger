module.exports = {
  default: {
    requireModule: ['tsx/cjs'],
    paths: ['tests/features/**/*.feature'],
    require: ['tests/step_defs/**/*.ts'],
    format: ['summary', 'progress'],
    formatOptions: { snippetInterface: 'async-await' }
  }
};
