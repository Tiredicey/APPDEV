(function () {
  var t = localStorage.getItem('admit-theme');
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
})();
