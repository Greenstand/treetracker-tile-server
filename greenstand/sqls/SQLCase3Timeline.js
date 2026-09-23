const SQLCase3 = require("./SQLCase3");

class SQLCase3Timeline extends SQLCase3{

  constructor(){
    super();
    this.timeline = undefined;
  }

  static checkTimeline(timeline){
    if(!timeline.match(/\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}/)){
      throw Error("Wrong timeline:" + timeline);
    }
  }

  addTimeline(timeline){
    SQLCase3Timeline.checkTimeline(timeline);
    this.timeline = timeline;
  }

  /* overwrite getJoin totally */
  getJoin(){
    let result = "";
    //disable parent getJoin, so, just do my job
    //no need to join it anymore
//    result += super.getJoin();
//    if(this.timeline){
//      result += "JOIN trees ON tree_region.tree_id = trees.id";
//    }
    return result;
  }
  
  /*the getFilter */
  getFilter(){
    let result = "";
    if(this.timeline){
      const [_, begin,end] = this.timeline.match(/(.*)_(.*)/);
      result += `
        AND trees.time_created > '${begin}' AND trees.time_created < '${end}'
      `;
    }
    if(this.userId){
      result += "AND trees.planter_id = " + this.userId + " \n";
    }
    return result;
  }

  getQuery2(){
    console.log('case 3 timline');
//    const query = {
    const text= `
        /* case3 timelinej*/
        ${this.getWith()}
        SELECT 'cluster'                                           AS type,
        St_asgeojson(St_centroid(clustered_locations))                 centroid,
        St_numgeometries(clustered_locations)                          count
        FROM   (
        SELECT Unnest(St_clusterwithin(estimated_geometric_location, ${this.getClusterRadius()})) clustered_locations
        FROM   trees 
        ${this.getJoin()}
        WHERE  active = true 
        ${this.getBoundingBoxQuery()} 
        ${this.getFilter()} 
        ${this.getJoinCriteria()}  
        ) clusters`;
//      values: [this.getClusterRadius()]
//    };
//    return query;
    return text;
  }
}

module.exports = SQLCase3Timeline;
