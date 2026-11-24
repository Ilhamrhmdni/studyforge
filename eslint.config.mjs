import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'docs/**',
      'scripts/test_e2e/**',
      'scripts/refactor_imports*.cjs'
    ]
  },
  js.configs.recommended,
  {
    files: ['functions/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.worker,
        ...globals.es2021
      }
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error'
    }
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.browser,
        supabase: 'readonly',
        pdfjsLib: 'readonly',
        Cropper: 'readonly',
        marked: 'readonly',
        SITE_CONFIG: 'writable',
        escapeHTML: 'writable',
        normalizeText: 'writable',
        stripMarkers: 'writable',
        hasCorrectMarker: 'writable',
        hasWrongMarker: 'writable',
        normalizeForCompare: 'writable',
        initSupabase: 'writable',
        checkUserAuth: 'writable',
        requireAuth: 'writable',
        logoutUser: 'writable',
        updateNavForUser: 'writable',
        getAccessToken: 'writable',
        apiFetch: 'writable',
        showToast: 'writable',
        compressForGemini: 'writable',
        formatGeminiError: 'writable',
        getQuestionQualityScore: 'writable',
        shouldMergeQuestionPair: 'writable',
        mergeQuestionPair: 'writable',
        mergeQuestionsByNumber: 'writable',
        parseWithGemini: 'writable',
        generateQuizDescription: 'writable',
        extractPdfText: 'writable',
        normalizePdfText: 'writable',
        parseAnswerKey: 'writable',
        parseQuestions: 'writable',
        validateParsedQuiz: 'writable'
      }
    },
    rules: {
      'no-unused-vars': 'off',
      'no-redeclare': 'off',
      'no-undef': 'error'
    }
  },
  {
    files: ['public/js/pages/admin*.js'],
    languageOptions: {
      sourceType: 'module'
    }
  },
  {
    files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      'no-unused-vars': 'warn',
      'no-undef': 'error'
    }
  }
];
