jest.mock('./Map', () => jest.fn());
const Map = require('./Map');
const { Config } = require('./config');

/*
 * Regression test for #125.
 *
 * The PGPool cache key is the SQL query text only, and that text does
 * not depend on the icon. So requests with different icons for the same
 * SQL query must still get the template of their own icon, from the
 * cache and in flight.
 * Before the fix, the cache kept the xml of the first request, with its
 * icon template, so the second request got the wrong icon.
 *
 * Each test sends 2 requests at zoom level 2, which takes the geojson
 * path, the only path that uses the cache. The 2 requests must share
 * 1 database query, so the fix keeps the cache hit rate.
 */
describe('getXMLString, different icons for the same SQL query', () => {
  let query;
  let config;

  beforeEach(() => {
    //Config reads these when it makes its PGPool. 60 s is the value on
    //dev and prod, so the cache entry does not expire during a test
    process.env.CACHE_SIZE = '100';
    process.env.CACHE_EXPIRE = '60000';
    //the SQL builder gives the same SQL query to all requests, so they
    //all use the same cache key
    Map.mockImplementation(() => ({
      init: jest.fn(),
      getQuery: jest.fn().mockResolvedValue('/* sql case1 */ fake_sql'),
    }));
    //the pg pool: each call is 1 database query
    query = jest.fn(async () => {
      //slow enough to let the other request arrive while this one is in flight
      await new Promise((res) => setTimeout(() => res(), 100));
      //1 row in the shape that the cluster SQL query returns
      return {
        rows: [
          {
            latlon: '{"type":"Point","coordinates":[-13.2,8.4]}',
            count: '10',
            count_text: '10',
            id: 1,
            type: 'cluster',
            zoom_to: null,
          },
        ],
      };
    });
    config = new Config({ query });
  });

  //xml2.js makes the ptk-s template from the ptk-b one, with the markers
  //scaled to 0.81. The id of the row shows that the geojson is in the xml
  function expectIcon(xmlString, icon) {
    if (icon === 'ptk-s') {
      expect(xmlString).toMatch(/scale\(0\.81\)/);
      expect(xmlString).not.toMatch(/scale\(1\)/);
    } else {
      expect(xmlString).toMatch(/scale\(1\)/);
      expect(xmlString).not.toMatch(/scale\(0\.81\)/);
    }
    expect(xmlString).toMatch(/"id": 1/);
  }

  it('ptk-b, then ptk-s', async () => {
    //the second request is a cache hit
    expectIcon(
      await config.getXMLString({ zoomLevel: 2, icon: 'ptk-b' }),
      'ptk-b',
    );
    expectIcon(
      await config.getXMLString({ zoomLevel: 2, icon: 'ptk-s' }),
      'ptk-s',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('ptk-s, then ptk-b', async () => {
    //the second request is a cache hit
    expectIcon(
      await config.getXMLString({ zoomLevel: 2, icon: 'ptk-s' }),
      'ptk-s',
    );
    expectIcon(
      await config.getXMLString({ zoomLevel: 2, icon: 'ptk-b' }),
      'ptk-b',
    );
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('ptk-b and ptk-s in flight at the same time', async () => {
    //PGPool queues the second request on the query of the first one
    const [xmlB, xmlS] = await Promise.all([
      config.getXMLString({ zoomLevel: 2, icon: 'ptk-b' }),
      config.getXMLString({ zoomLevel: 2, icon: 'ptk-s' }),
    ]);
    expectIcon(xmlB, 'ptk-b');
    expectIcon(xmlS, 'ptk-s');
    expect(query).toHaveBeenCalledTimes(1);
  });
});
