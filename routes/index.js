var express = require('express')
  , router = express.Router()
  , queue = require('./../lib/q');

/* GET home page. */
router.get('/', function(req, res, next) {
  res.json({ success: true });
});

/* POST A JOB */

router.post('/v1/jobs/:jobType', function(req, res, next){
  console.log("Creating " + req.params.jobType + " job");
  queue.addJob(req.params.jobType, req.body, function(err, jobid){
    if(err){
      console.log("Error occurred:" + err);
      next(err);
    }
    res.json({message: "job created successfully", jobid : jobid});
  });
});

/* GET JOB INFO */

router.get('/v1/jobs/:jobid', function(req, res, next){
  console.log("Info for job with id:" + req.params.jobid);
  queue.jobState(req.params.jobid, function(err, job){
    log.info("JOb info : " + job);
    if(err) {
      console.log("Error occurred: " + err);
    }
    res.json({jobInfo: job});
  });
});


/* DELETE JOBS */

router.delete('/v1/jobs/:jobid', function(req, res, next){
  console.log("Deleting job with id:" + req.params.jobid);
  queue.removeJob(req.params.jobid, function(err){
    if(err) {
      console.log("Error occurred: " + err)
    }
    res.json({success: true, message: "job with id:" + req.params.jobid + " has been removed"});
  });
});



module.exports = router;
