/* Firebase web settings for Shanta and the shop, kept apart so the other files never contain the key.
   The web key is public by design (every visitor's browser receives it); access is decided by the
   Firestore rules and sign-in. Restrict it to https://wissa-azmy.github.io/* in Google Cloud. */
window.SHANTA_FIREBASE = {
  apiKey: 'AIzaSyAa9fTvt1RxGFDGf1rWFLBB_gvVlaOkphM',
  authDomain: 'shanta-dm.firebaseapp.com',
  projectId: 'shanta-dm'
};
