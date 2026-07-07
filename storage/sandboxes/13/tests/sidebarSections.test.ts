import { groupSidebarItems } from '../src/sidebarSections';
const grouped = groupSidebarItems([{ id: 'a', group: 'nav', label: 'A' }, { id: 'b', group: 'nav', label: 'B' }]);
if (grouped['nav'].length !== 2) { throw new Error('fail'); }
console.log('ok');
