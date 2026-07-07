const { groupRoutesByResource } = require('../src/routes.js');
const grouped = groupRoutesByResource([{ path: '/modules/install' }, { path: '/modules/rollback' }]);
if (grouped.modules.length !== 2) { throw new Error('fail'); }
console.log('ok');
