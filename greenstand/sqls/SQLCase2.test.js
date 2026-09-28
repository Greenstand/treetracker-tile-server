const fs = require('fs');
const path = require('path');
const SQLCase2 = require('./SQLCase2');
const SQLCase2Wallet = require('./SQLCase2Wallet');

describe('SQLCase2 spatial filtering', () => {
  test('applies the bounding box in the primary trees query', () => {
    const query = new SQLCase2();
    query.setBounds('-13.27,8.40,-13.25,8.42');

    const sql = query.getQuery();

    expect(sql).toMatch(
      /FROM trees[\s\S]*WHERE active = true[\s\S]*estimated_geometric_location && ST_MakeEnvelope/,
    );
    expect(sql).toContain('St_asgeojson(estimated_geometric_location) latlon');
    expect(sql).toMatch(/'point' AS type[\s\S]*trees\.id[\s\S]*1 as count/);
    expect(sql).not.toContain('WITH placeholder');
    expect(sql).not.toMatch(/ORDER BY ID DESC/i);
  });

  test('does not sort the wallet query before spatial filtering', () => {
    const query = new SQLCase2Wallet();
    query.setBounds('-13.27,8.40,-13.25,8.42');
    query.addFilterByWallet('example');

    const sql = query.getQuery();

    expect(sql).toMatch(
      /FROM trees[\s\S]*WHERE active = true[\s\S]*estimated_geometric_location && ST_MakeEnvelope/,
    );
    expect(sql).not.toContain('WITH placeholder');
    expect(sql).not.toMatch(/ORDER BY ID DESC/i);
  });
});

describe('static PostGIS datasource', () => {
  test("pushes Mapnik's bbox token into the trees datasource", () => {
    const xml = fs.readFileSync(
      path.join(__dirname, '../layers/postgis.xml'),
      'utf8',
    );

    expect(xml).toMatch(
      /SELECT \* FROM trees[\s\S]*WHERE active = true[\s\S]*estimated_geometric_location && !bbox!/i,
    );
    expect(xml).not.toMatch(/ORDER BY id DESC/i);
  });
});
