(() => {
  const query = new URLSearchParams(location.search);
  const id = query.get('lead') || query.get('id') || '';
  location.replace(`/leads.html${/^[a-f0-9]{32}$/.test(id) ? `?lead=${id}` : ''}`);
})();
