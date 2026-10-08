// Beanstalk docs: the left nav is a <details> that is open on wide screens (its summary is
// hidden there) and starts closed on a phone, where it sits above the article.
const docsNav = document.querySelector('details.dnav');
const narrow = matchMedia('(max-width: 900px)');

function fitNav() {
  if (docsNav) docsNav.open = !narrow.matches;
}

fitNav();
narrow.addEventListener('change', fitNav);
