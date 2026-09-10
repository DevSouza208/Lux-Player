const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('game editor has one shared form for the catalog and admin panel',()=>{
 const html=fs.readFileSync('index.html','utf8');
 const ids=[...html.matchAll(/\bid="(gameUploadModal|gameAdmin[^"]*|gameMetadataResults)"/g)].map(match=>match[1]);
 for(const id of new Set(ids))assert.equal(ids.filter(value=>value===id).length,1,`Duplicate editor element: ${id}`);
 assert.ok(ids.includes('gameUploadModal'));
 const panel=html.slice(html.indexOf('<div id="adminTabGames"'),html.indexOf('<div id="adminTabBooks"'));
 assert.match(panel,/toggleGameUploadModal\(\)/);assert.match(panel,/reviewUnapprovedGames\(\)/);
 assert.ok(!panel.includes('id="gameUploadModal"'),'Shared editor must not be inside the hidden admin panel');
});
