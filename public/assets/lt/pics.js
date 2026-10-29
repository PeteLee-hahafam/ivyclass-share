// 레벨테스트 초1 단계 그림 (낱말, 문장 고르기용). 문제 은행(src/lt/core.js)의 pic 이름과 같아요.
export const LT_PICS = (() => {
  const apple = (tf) => `<g transform="${tf}"><path d="M0 -18C-8 -26 -28 -26 -28 -4C-28 14 -14 28 -6 28C-3 28 -2 26 0 26C2 26 3 28 6 28C14 28 28 14 28 -4C28 -26 8 -26 0 -18Z" fill="#d94a3d"/><path d="M0 -18C0 -24 2 -30 6 -34" stroke="#7a5230" stroke-width="3.2" fill="none" stroke-linecap="round"/><path d="M4 -27C10 -35 20 -36 25 -32C19 -25 10 -23 4 -27Z" fill="#4a9a52"/><ellipse cx="-14" cy="-6" rx="4.5" ry="8" fill="#ffffff" opacity=".32"/></g>`;
  const ball = (tf, c) => `<g transform="${tf}"><circle r="24" fill="${c}"/><path d="M-23 -6C-8 2 8 2 23 -6" stroke="#ffffff" stroke-width="3.4" fill="none" opacity=".9"/><path d="M-21 10C-6 17 6 17 21 10" stroke="#ffffff" stroke-width="3.4" fill="none" opacity=".9"/><ellipse cx="-10" cy="-13" rx="5" ry="3.5" fill="#ffffff" opacity=".35"/></g>`;
  const wrap = (body) => `<svg viewBox="0 0 120 90" role="img" aria-hidden="true">${body}</svg>`;
  return {
    cat: wrap(`<path d="M34 34L38 10L55 25Z" fill="#e8964a"/><path d="M86 34L82 10L65 25Z" fill="#e8964a"/><path d="M39 29L41 18L49 25Z" fill="#f6c3b5"/><path d="M81 29L79 18L71 25Z" fill="#f6c3b5"/><ellipse cx="60" cy="50" rx="30" ry="27" fill="#f0a65a"/><ellipse cx="49" cy="46" rx="3.6" ry="5" fill="#2a2a2a"/><ellipse cx="71" cy="46" rx="3.6" ry="5" fill="#2a2a2a"/><path d="M56 55L64 55L60 59Z" fill="#d9707a"/><path d="M60 59C58 64 53 65 51 62M60 59C62 64 67 65 69 62" stroke="#7a4a2a" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M44 57L22 53M44 61L22 64M76 57L98 53M76 61L98 64" stroke="#7a4a2a" stroke-width="1.6" stroke-linecap="round"/>`),
    apple1: wrap(apple('translate(60 50)')),
    apple2: wrap(apple('translate(37 52) scale(.78)') + apple('translate(83 52) scale(.78)')),
    ball2: wrap(ball('translate(38 50) scale(.82)', '#d94a3d') + ball('translate(82 50) scale(.82)', '#d94a3d')),
    ballRed: wrap(ball('translate(60 47)', '#d94a3d')),
    ballBlue: wrap(ball('translate(60 47)', '#3d7cc9')),
    hatBlue: wrap(`<ellipse cx="60" cy="62" rx="36" ry="9" fill="#2b5f9e"/><path d="M38 60C38 30 82 30 82 60Z" fill="#3d7cc9"/><rect x="38" y="51" width="44" height="7" fill="#24508a"/>`),
  };
})();
