var kue = require('kue-scheduler')
  , basicAuth = require('basic-auth-connect')
  , express = require('express')
  , conf = require('../utils/config');

// Setup start
var q = kue.createQueue({
  prefix: 'dq',
  redis: {
    port: conf.get('dq:redis:port') || 6379,
    host: conf.get('dq:redis:host') || 'localhost',
    db: conf.get('dq:redis:db') || 'dq'
  }
});

q.watchStuckJobs(conf.get('dq:queue:watch_interval') || 10000);

// Mark incomplete jobs before shutdown as active so that they can be retried
q.active( function( err, ids ) {
  ids.forEach( function( id ) {
    kue.Job.get( id, function( err, job ) {
      job.inactive();
    });
  });
});


if ( conf.get('dq:ui:enabled')) {
  var app = express();
  if ( conf.get('dq:ui:auth:username') && conf.get('dq:ui:auth:password') ) {
    app.use(basicAuth('foo', 'bar'));
  }
  kue.app.set('title', conf.get('dq:ui:title') || 'DQ');
  app.use(kue.app);
  app.listen(conf.get('dq:ui:port') || 3000);
}

q.on('schedule error', function(error) {
  console.log( 'Error in scheduling: ', error );
});

q.on('schedule success', function(job) {
  console.log( 'success in scheduling: ', job.id );
});

q.on('already scheduled', function(job) {
  console.log(job.id, 'already scheduled ' );
});

q.on( 'error', function( err ) {
  console.log( 'Error in queue: ', err );
});

process.once( 'SIGTERM', function ( sig ) {
  q.shutdown( 5000, function(err) {
    console.log( 'Kue shutdown: ', err||'' );
    process.exit( 0 );
  });
});

// Setup End


var addJob = function(job_type, options, callback) {
  if (conf.get('jobs:' + job_type) == undefined) {
    return callback(new Error('Incorrect job type ' + job_type));
  }
  var job = q.createJob(job_type, options); // options contains job-specific options

  if (conf.get('jobs:' + job_type + ':priority')) {
  // Possible values : { low: 10, normal: 0, medium: -5, high: -10, critical: -15 }
    job.priority(conf.get('jobs:' + job_type + ':priority'));
  }

  if (conf.get('jobs:' + job_type + ':attempts')) {
    job.attempts(conf.get('jobs:' + job_type + ':attempts'));
  }

  if (conf.get('jobs:' + job_type + ':backoff')) {
    job.backoff(conf.get('jobs:' + job_type + ':backoff'));
  }

  if (conf.get('jobs:' + job_type + ':ttl')) {
    job.ttl(conf.get('jobs:' + job_type + ':ttl'));
  }

  // callback(null, job);

  job.save(function(err) {
    if (err) callback(err);
    else {
      if (conf.get('jobs:' + job_type + ':repeat')) {
        q.every(conf.get('jobs:' + job_type + ':repeat'), job);
      } else {
        q.now(job);
      }
      callback(null, job.id);
    }
  })
}


var removeJob = function(job_id, callback) {
  kue.Job.get( job_id, function(err, job) {
    if (err) { return callback(err) }
      job.remove(callback)
  }); // Args to callback - err
}


var jobState = function(job_id, callback) {
  kue.Job.get( job_id, callback); // Args to callback - err, job
}


Object.keys(conf.get('jobs')).forEach( function(job_type) {
  q.process(job_type,
    conf.get('jobs:' + job_type + ':batch') || 1,
    function(job, done) {

    var opts = {
      image: conf.get('jobs:' + job_type + ':image'),
      command: conf.get('jobs:' + job_type + ':command'),
      volumes: conf.get('jobs:' + job_type + ':volumes'),
      dab: conf.get('jobs:' + job_type + ':dab'),
      removeOnComplete : conf.get('jobs:' + job_type + ':remove') || false
    }

    // Handle uncaught exceptions in executor
    var domain = require('domain').create();
    domain.on('error', function(err){
      done(err);
    });
    domain.run(function() { executor.execute(job, opts, done)} ); // done - err or null
  });
});

exports.addJob = addJob;
exports.removeJob = removeJob;
exports.jobState = jobState;


// Test method
var executor = {
  execute : function(job, opts, callback) {
    console.log('got data', job.data, opts);
    callback();
  }
}

// TODO: Make this module event based
// // - `enqueue` the job is now queued
// // - `start` the job is now running
// // - `promotion` the job is promoted from delayed state to queued
// // - `progress` the job's progress ranging from 0-100
// // - `failed attempt` the job has failed, but has remaining attempts yet
// // - `failed` the job has failed and has no remaining attempts
// // - `complete` the job has completed
// // - `remove` the job has been removed
// queue.on('job enqueue', function(id, type){
//   console.log( 'Job %s got queued of type %s', id, type );
// })
