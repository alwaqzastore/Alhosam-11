import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';

export default [
  {
    ignores: ['dist/**/*', 'dev-dist/**/*', 'node_modules/**/*', 'src/**/*', 'android/**/*', 'capacitor.config.ts']
  },
  firebaseRulesPlugin.configs['flat/recommended']
];
