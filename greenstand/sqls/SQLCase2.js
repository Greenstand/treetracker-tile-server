/*
 * Search DB by trees table directly, like in the high zoom level, show trees
 * on the map;
 */



class SQLCase2 {


  addTreeFilter(treeid) {
    this.treeid = treeid;
  }

  addUUIDFilter(uuid) {
    this.uuid = uuid;
  }


  addTreesFilter() {
    throw new Error("dedicated");
  }

  addFilterByUserId(userId) {
    this.userId = userId;
  }

  addFilterByWallet(wallet) {
    this.wallet = wallet;
  }

  addFilterByFlavor(flavor) {
    this.flavor = flavor;
  }

  addFilterByToken(token) {
    this.token = token;
  }

  addFilterByMapName(mapName) {
    this.mapName = mapName;
  }

  getFilter() {
    let result = "";
    if (this.treeid) {
      result += 'AND trees.id = ' + this.treeid + ' \n';
    }
    if (this.uuid) {
      result += 'AND trees.uuid = ' + this.uuid + ' \n';
    }
    if (this.userId) {
      result += "AND trees.planter_id = " + this.userId + " \n";
    }
    if (this.wallet) {
      result += "AND wallet.wallet.name = '" + this.wallet + "'\n"
    }
    if (this.mapName) {
      result += `
          AND (
              trees.planter_id IN (SELECT id FROM planter_in_org)
            OR
              trees.planting_organization_id = (
                select id from entity where map_name = '${this.mapName}'
              )
          )
      `;
    }
    return result;
  }

  setBounds(bounds) {
    this.bounds = bounds;
  }

  getBoundingBoxQuery() {
    let result = "";
    if (this.bounds) {
      result += 'AND trees.estimated_geometric_location && ST_MakeEnvelope(' + this.bounds + ', 4326) ';
    }
    return result;
  }

  getJoinCriteria() {
    let result = "";
    if (this.flavor) {
      result += "AND tree_attributes.key = 'app_flavor' AND tree_attributes.value = '" + this.flavor + "'";
    }
    if (this.token) {
      result += "INNER JOIN certificates ON trees.certificate_id = certificates.id AND certificates.token = '" + this.token + "'";
    }
    return result;
  }

  getJoin() {
    let result = "";
    if (this.wallet) {
      result += 'INNER JOIN wallet.token ON wallet.token.capture_id::text = lower(trees.uuid) \n';
      result += 'INNER JOIN wallet.wallet ON wallet.wallet.id = wallet.token.wallet_id \n';
    }
    if (this.flavor) {
      result += "INNER JOIN tree_attributes ON tree_attributes.tree_id = trees.id";
    }
    return result;
  }

  getWith() {
    let withClause = `WITH placeholder AS (SELECT 1)`;
    if (this.mapName) {
      //replace the withClause 
      withClause = `
        WITH RECURSIVE organization_children AS (
          SELECT entity.id, entity_relationship.parent_id, 1 as depth, entity_relationship.type, entity_relationship.role
          FROM entity
          LEFT JOIN entity_relationship ON entity_relationship.child_id = entity.id
          WHERE entity.id IN (SELECT id FROM entity WHERE map_name = '${this.mapName}')
          UNION
          SELECT next_child.id, entity_relationship.parent_id, depth + 1, entity_relationship.type, entity_relationship.role
          FROM entity next_child
          JOIN entity_relationship ON entity_relationship.child_id = next_child.id
          JOIN organization_children c ON entity_relationship.parent_id = c.id
        )
        ,planter_in_org AS (
          SELECT id FROM planter
          JOIN (
            SELECT id AS entity_id FROM organization_children LIMIT 20
            ) org ON planter.organization_id = org.entity_id
          )
        `;
    }
    return withClause;
  }

  getQuery() {
    let sql = `
      /* sql case2 tile */
      ${this.getWith()}
      SELECT /* DISTINCT ON(trees.id) */
      'case2 tile' AS log,
      estimated_geometric_location,
      St_asgeojson(estimated_geometric_location) latlon, 
      'point' AS type,
       trees.id, 
       trees.lat, 
       trees.lon,
      NULL AS zoom_to,
      1 as count
      FROM trees 
      ${this.getJoin()}
      WHERE active = true 
      ${this.getBoundingBoxQuery()}
      ${this.getFilter()}
      ${this.getJoinCriteria()}
      ORDER BY ID DESC
    `
      ;
    console.log(sql);
    return sql;
  }
}


module.exports = SQLCase2;
