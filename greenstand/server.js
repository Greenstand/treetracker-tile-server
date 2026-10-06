require('dotenv').config();
const log = require('loglevel');
log.setDefaultLevel('info');
const app = require('./app');
const expect = require('expect-runtime');

expect(process.env.MAXIMUM_ZOOM_LEVEL_USING_GLOBAL_DATASET).defined();
expect(process.env.MAXIMUM_ZOOM_LEVEL_HANDLING_ZOOM_TARGET).defined();

const server = app.listen(process.env.PORT, () => {
  log.info('listening on %d', process.env.PORT);
});

async function shutdown(signal) {
  log.info('received %s, draining tile resources', signal);
  await app.shutdown();
  server.close(() => process.exit(0));
}

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
