export function prefersRedirectSignIn(userAgent = '', maxTouchPoints = 0) {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)
    || (/Macintosh/i.test(userAgent) && maxTouchPoints > 1);
}

export function friendlyAuthError(problem) {
  const code = problem?.code || '';
  const message = problem?.message || '';
  if (
    ['auth/web-storage-unsupported', 'auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(code)
    || /missing initial state|sessionStorage|storage-partitioned/i.test(message)
  ) {
    return 'Google sign-in could not finish in this browser. Open the planner directly in Safari or Chrome, leave Private Browsing, and try again.';
  }
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return 'Google sign-in was cancelled. Please try again.';
  return message || 'Google sign-in failed. Please try again.';
}
