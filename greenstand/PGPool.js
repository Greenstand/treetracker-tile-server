const log = require("loglevel");
const LRU = require("lru-cache");

class PGPool{
  
  /*
   * Options:
   *  cacheSize: the size of the LRU cache
   *  cacheExpire: the time to expire
   */
  constructor(options){
    this.options = {
      ...{ cacheSize: 10000, cacheExpire: 1000 * 60 * 4, }, ...options, };
    log.warn("set the pg pool by:", this.options); this.cache = new LRU({
      max: this.options.cacheSize,
      maxAge: this.options.cacheExpire,
    });
    this.pool = this.options.pool;
    this.queue = {
    };
    this.isFetching = {
    };
  }

  fetch(sql, handleResult, callback){
    log.warn("fetch");
    if(!this.queue[sql]){
      this.queue[sql] = [];
    }
    this.queue[sql].push(callback);
    if(this.isFetching[sql]){
      log.warn("is fetching, queue");
    }else{
      this.isFetching[sql] = true;
      const begin = Date.now();
      this.pool.query({
        text: sql,
        values:[]
      }).then(result => {
        log.warn("get from db:%d, took time:%d", result.rows.length, Date.now() - begin);
        const resultHandled = handleResult? handleResult(result):result;
        while(this.queue[sql].length > 0){
          const cb = this.queue[sql].pop();
          cb(null, resultHandled);
        }
        this.cache.set(sql,resultHandled);
        this.isFetching[sql] = false;
        log.warn("fetch finished");
      }).catch(e => {
        log.error("get error when query db:", e);
        this.isFetching[sql] = false;
        while(this.queue[sql] && this.queue[sql].length > 0){
          const cb = this.queue[sql].pop();
          cb(e, null);
        }
      });
    }
  }

  /*
   * handleResult to manipulate the result , here 
   * is translate the result of db rows to geojson.
   * The cache key is the sql only, so the result
   * must not depend on anything else, like the icon
   */
  getQuery(sql, handleResult){
    log.info("get query");
    return new Promise((res, rej) => {
      const value = this.cache.get(sql);
      if(value){
        log.warn("cache bingo!");
        res(value);
      }else{
        this.fetch(sql, handleResult, (err, result)=>{
          log.warn("fetch callback");
          if(err) return rej(err);
          res(result);
        });
      }
    });
  }

  hasCached(sql){
    const value = this.cache.get(sql);
    if(value){
      return true;
    }else{
      return false;
    }
  }
}

module.exports = PGPool;
