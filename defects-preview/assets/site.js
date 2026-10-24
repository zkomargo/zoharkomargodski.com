(function () {
  'use strict';
  document.documentElement.classList.add('js');
  var toggle = document.querySelector('.menu-toggle');
  var nav = document.getElementById('navigation');
  if (toggle && nav) {
    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      toggle.querySelector('span').textContent = open ? '−' : '+';
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) {
        toggle.setAttribute('aria-expanded', 'false');
        nav.classList.remove('is-open');
        toggle.querySelector('span').textContent = '+';
        toggle.focus();
      }
    });
  }
}());
