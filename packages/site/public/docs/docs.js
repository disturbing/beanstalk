// Gitstalk docs: the left nav is a <details> served closed. docs.css shows its content on wide
// screens through ::details-content; a browser without that pseudo-element opens it here instead
// (only on wide screens, so a phone never shifts).
const docsNav = document.querySelector('details.dnav');
const wide = matchMedia('(min-width: 901px)');

if (docsNav && !CSS.supports('selector(::details-content)')) {
  const fitNav = () => {
    docsNav.open = wide.matches;
  };
  fitNav();
  wide.addEventListener('change', fitNav);
}
