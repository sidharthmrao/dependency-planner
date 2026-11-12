import assert from 'node:assert/strict';
import test from 'node:test';
import { friendlyAuthError, prefersRedirectSignIn } from './authFlow.js';

test('mobile and iPadOS browsers use redirect sign-in', () => {
  assert.equal(prefersRedirectSignIn('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), true);
  assert.equal(prefersRedirectSignIn('Mozilla/5.0 (Linux; Android 15; Pixel 9) Mobile'), true);
  assert.equal(prefersRedirectSignIn('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 5), true);
  assert.equal(prefersRedirectSignIn('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)', 0), false);
});

test('storage failures receive actionable guidance', () => {
  assert.match(friendlyAuthError({ message: 'Unable to process request due to missing initial state.' }), /Safari or Chrome/);
  assert.match(friendlyAuthError({ code: 'auth/popup-closed-by-user' }), /cancelled/);
});
