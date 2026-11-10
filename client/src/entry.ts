// lumen.js: loads Lumen's code from a content-named file. The player (views/player/lazyPlayer.tsx), which loads later,
// imports that same file by the same URL. If the code lived in lumen.js itself, the player would import "./lumen.js"
// without the page's ?v= and the browser would run a second copy of Lumen (and of Preact) next to the first.
void import('./main');
