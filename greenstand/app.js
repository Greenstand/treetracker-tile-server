const express = require('express');
const mapnik = require('../lib/mapnik');
const path = require('path');
const log = require('loglevel');
const cors = require('cors');
const { Pool } = require('pg');
const { Config } = require('./config');
const MapnikPool = require('./MapnikPool');
const mercator = require('./sphericalmercator');

const connectionString = process.env.DB_URL;
const max =
  (process.env.PG_POOL_SIZE && parseInt(process.env.PG_POOL_SIZE, 10)) || 10;
log.info('pool settings:db:%s; pool size: %d', connectionString, max);
const pool = new Pool({ connectionString, max });
const config = new Config(pool);
const fontPath = path.join(__dirname, '../test/data/map-a/');

mapnik.register_default_fonts();
mapnik.register_default_input_plugins();
log.info('fonts:', mapnik.fonts());
mapnik.Logger.setSeverity(mapnik.Logger.DEBUG);
log.info('log level of mapnik:', mapnik.Logger.getSeverity());

function createMap(configuration) {
  const mapInstance = new mapnik.Map(256, 256);
  mapInstance.registerFonts(fontPath, { recurse: true });
  return new Promise((resolve, reject) => {
    mapInstance.fromString(
      configuration,
      { strict: true, base: __dirname },
      (err, loadedMap) => {
        if (err) {
          log.error('e when fromString:', err);
          reject(err);
        } else {
          resolve(loadedMap || mapInstance);
        }
      },
    );
  });
}

const mapnikPool = new MapnikPool({
  max: parseInt(process.env.MAPNIK_POOL_MAX || '8', 10),
  acquireTimeout: parseInt(
    process.env.MAPNIK_POOL_ACQUIRE_TIMEOUT_MS || '5000',
    10,
  ),
  create: () => {
    throw new Error('A Mapnik configuration is required');
  },
});

function stableParams(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${JSON.stringify(params[key])}`)
    .join('&');
}

async function prepareMap(x, y, z, params) {
  const bboxDb = mercator.xyz_to_envelope_db_buffer(
    parseInt(x, 10),
    parseInt(y, 10),
    parseInt(z, 10),
    false,
    100,
  );
  const bounds = bboxDb.join(',');
  const configuration = await config.getXMLString({
    zoomLevel: z,
    bounds,
    ...params,
  });
  return {
    key: `${x}/${y}/${z}?${stableParams(params)}`,
    configuration,
    bbox: mercator.xyz_to_envelope(
      parseInt(x, 10),
      parseInt(y, 10),
      parseInt(z, 10),
      false,
    ),
  };
}

async function withMapInstance(x, y, z, params, render) {
  const prepared = await prepareMap(x, y, z, params);
  return mapnikPool.use(
    prepared.key,
    async (map) => {
      map.extent = prepared.bbox;
      return render(map);
    },
    () => createMap(prepared.configuration),
  );
}

async function renderImage(x, y, z, params) {
  return withMapInstance(x, y, z, params, (map) => {
    const image = new mapnik.Image(256, 256);
    return new Promise((resolve, reject) => {
      map.render(image, (err, renderedImage) => {
        if (err) return reject(err);
        renderedImage.encode('png', (encodeError, buffer) => {
          if (encodeError) return reject(encodeError);
          resolve(buffer);
        });
      });
    });
  });
}

async function renderGrid(x, y, z, params) {
  return withMapInstance(x, y, z, params, (map) => {
    const grid = new mapnik.Grid(256, 256);
    const fields = ['id', 'latlon', 'count', 'type'];
    if (parseInt(z, 10) <= 9) fields.push('zoom_to');
    return new Promise((resolve, reject) => {
      map.render(grid, { layer: 'l1', fields }, (err, renderedGrid) => {
        if (err) return reject(err);
        resolve(renderedGrid.encodeSync({ resolution: 4, features: true }));
      });
    });
  });
}

const app = express();
app.use(cors());

const viewer = path.join(__dirname, './examples/viewer');
app.use('/viewer', express.static(viewer));
app.use('/viewer/images', express.static(path.join(viewer, 'images')));

async function sendImage(req, res, newIcons) {
  const { x, y, z } = req.params;
  const begin = Date.now();
  const buffer = await renderImage(x, y, z, {
    ...req.query,
    ...(newIcons ? { newIcons: true } : {}),
  });
  log.info('Render map took:', Date.now() - begin, x, y, z, '.png');
  res.set({ 'Content-Type': 'image/png' });
  res.end(buffer);
}

async function sendGrid(req, res, newIcons) {
  const { x, y, z } = req.params;
  const begin = Date.now();
  const json = await renderGrid(x, y, z, {
    ...req.query,
    ...(newIcons ? { newIcons: true } : {}),
  });
  log.info('Render map took:', Date.now() - begin, x, y, z, '.grid');
  res.set({ 'Content-Type': 'application/json' });
  res.json(json);
}

app.get('/:z/:x/:y.png', async (req, res) => {
  try {
    await sendImage(req, res, false);
  } catch (error) {
    log.error('got error in handler:', error);
    res.status(500).json({ message: `something wrong:${error}` });
  }
});

app.get('/:z/:x/:y.grid.json', async (req, res) => {
  try {
    await sendGrid(req, res, false);
  } catch (error) {
    log.error('got error in handler:', error);
    res.status(500).json({ message: `something wrong:${error}` });
  }
});

app.get('/new/:z/:x/:y.png', async (req, res) => {
  try {
    await sendImage(req, res, true);
  } catch (error) {
    log.error('got error in handler:', error);
    res.status(500).json({ message: `something wrong:${error}` });
  }
});

app.get('/new/:z/:x/:y.grid.json', async (req, res) => {
  try {
    await sendGrid(req, res, true);
  } catch (error) {
    log.error('got error in handler:', error);
    res.status(500).json({ message: `something wrong:${error}` });
  }
});

app.use('*', (_, res) => {
  const pjson = require('../package.json');
  res
    .status(200)
    .send(`Welcome to Greenstand tile server, version:${pjson.version}`);
});

app.mapnikPool = mapnikPool;
app.shutdown = async () => {
  await mapnikPool.drain();
  await pool.end();
};

module.exports = app;
