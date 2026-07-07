function groupRoutesByResource(routes) {
  const out = {};
  for (const r of routes) {
    const key = r.path.split('/')[1] || 'root';
    (out[key] ||= []).push(r);
  }
  return out;
}
module.exports = { groupRoutesByResource };
