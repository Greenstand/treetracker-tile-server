/*
 * Search DB by trees table directly, like in the high zoom level, show trees
 * on the map;
 */
const SQLCase2 = require('./SQLCase2');

class SQLCase2Wallet extends SQLCase2 {
  addTreesFilter() {
    throw new Error('dedicated');
  }

  addFilterByUserId(userId) {
    throw new Error('dedicated');
  }

  addFilterByFlavor(flavor) {
    throw new Error('dedicated');
  }

  addFilterByToken(token) {
    throw new Error('dedicated');
  }

  addFilterByMapName(mapName) {
    throw new Error('dedicated');
  }

  getFilter() {
    let result = '';
    return result;
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  getJoinCriteria() {
    return '';
  }

  getJoin() {
    let result = '';
    return result;
  }

  getWith() {
    return '';
  }

  getQuery() {
    let sql = `
      /* sql case2 wallet tile */
      SELECT tree_token.*, w.name FROM (
        ${this.getWith()}
        SELECT 
        'case2 tile wallet' AS log,
        estimated_geometric_location,
        St_asgeojson(estimated_geometric_location) latlon,
        'point' AS type,
         trees.id, 
         trees.lat, 
         trees.lon,
         t.wallet_id,
        NULL AS zoom_to,
        1 as count
        FROM trees 
        JOIN wallet."token" t ON t.capture_id::TEXT = lower(trees.uuid)
        ${this.getJoin()}
        WHERE active = true 
        ${this.getBoundingBoxQuery()}
        ${this.getFilter()}
        ${this.getJoinCriteria()}
      ) tree_token
      JOIN wallet.wallet w ON w.id = tree_token.wallet_id
      WHERE w.name = '${this.wallet}'
    `;
    console.log(sql);
    return sql;
  }
}

module.exports = SQLCase2Wallet;
