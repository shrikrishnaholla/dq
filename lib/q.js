var kue = require('kue')
  , basicAuth = require('basic-auth-connect')
  , express = require('express')
  , Cron = require('cron-converter')
  , cronInstance = new Cron()
  , debug = require('debug')('dq:q')
  , conf = require('../utils/config')
  , executor = require('./executor');

var svc_mappings = {};

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


// Start Kue UI server
if ( conf.get('dq:ui:enabled')) {
  var app = express();
  if ( conf.get('dq:ui:auth:username') && conf.get('dq:ui:auth:password') ) {
    app.use(basicAuth('foo', 'bar'));
  }
  kue.app.set('title', conf.get('dq:ui:title') || 'DQ');
  app.use(kue.app);
  app.listen(conf.get('dq:ui:port') || 3000);
}

q.on( 'error', function( err ) {
  console.log( 'Error in queue: ', err );
  shutdownKue();
});

process.once( 'SIGTERM', function ( sig ) {
  shutdownKue();
});

var shutdownKue = function() {
  q.shutdown( 5000, function(err) {
    console.log( 'Kue shutdown: ', err||'' );
    process.exit( 0 );
  });
}

// Setup End


var addJob = function(job_type, options, callback) {
  if (conf.get('jobs:' + job_type) == undefined) {
    return callback(new Error('Incorrect job type ' + job_type));
  }
  var job = q.create(job_type, options); // options contains job-specific options

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

  // Recurrent jobs
  if (conf.get('jobs:' + job_type + ':repeat')) {
    cronInstance.fromString(conf.get('jobs:' + job_type + ':repeat'));
    var schedule = cronInstance.schedule();
    var next = schedule.next();

    // If last executed ts is same as next execution date, increment schedule
    // To handle sub-second execution recurrent jobs
    kue.redis.client().get('dq:repeat:' + job_type, function(redis_err, reply) {
      if (redis_err) {
        return callback(redis_err);
      }
      if (reply) {
        last_ts = reply.split('::')[1]; // unix ts of last exec
        if (next.valueOf().toString() == last_ts ) {
          next = schedule.next();
        }
      }
      job.delay(next.toDate());

      // Save ts of the next execution schedule in redis
      kue.redis.client().set('dq:repeat:' + job_type,
        JSON.stringify(options) + '::' + next.valueOf().toString());
    });
  }

  job.save(function(err) {
    if (err) callback(err);
    else {
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


// Job processing
Object.keys(conf.get('jobs')).forEach( function(job_type) {
  q.process(job_type,
    conf.get('jobs:' + job_type + ':batch') || 1,
    function(job, done) {

      if (conf.get('jobs:' + job_type + ':service')) {
        var endpoint_conf_str = 'jobs:' + job_type + ':service:endpoints:' + job.data.endpoint;
        executor.mkRequest(svc_mappings[job_type], {
          method: conf.get(endpoint_conf_str + ':method'),
          uri: conf.get(endpoint_conf_str + ':uri'),
          qs: job.data.qs,
          body: job.data.body
        }, done);

      } else {

        // Gather metadata for executor
        var opts = conf.get('jobs:' + job_type);
        opts.job_name = job_type;

        // Handle uncaught exceptions in executor
        var domain = require('domain').create();
        domain.on('error', function(err){
          done(err);
        });
        domain.run(function() {
          executor.execute(job, opts, function(error) {
            if (error) return done(error);

            // If recurring task, create a duplicate job for next execution
            if (conf.get('jobs:' + job_type + ':repeat')) {
              kue.redis.client().get('dq:repeat:' + job_type, function(redis_err, reply) {
                if (redis_err || (reply == null)) {
                  return done(redis_err ||
                    new Error('Invalid key: dq:repeat:' + job_type));
                }
                addJob(job_type, JSON.parse(reply.split('::')[0]),
                  function(new_job_err, new_job_id) {
                    done();
                });
              })
            } else {
              // Non-recurring, single execution job
              done();
            }
          })
        }); // done - err or null
      }
  });
});


// recurring jobs and services are initialized at process startup
// recurring tasks won’t take per-execution args that would be client-provided
Object.keys(conf.get('jobs')).forEach( function(job_type) {
  if(conf.get('jobs:' + job_type + ':repeat')) {
    if (conf.get('jobs:' + job_type + ':batch') !== undefined) {
      console.log('Cannot enable batch processing for recurrent job', job_type);
      shutdownKue();
    }
    kue.redis.client().exists('dq:repeat:' + job_type, function(redis_err, reply) {
      if (redis_err) {
        // If we encounter redis error, we shouldn't risk writes
        return debug('Redis error while fetching recurrent jobs');
      }
      // Need to add job only if it doesn't already exist
      if (reply == null || reply == 0 || reply == '0') {
        // add job
        addJob(job_type, {}, function(error, job_id) {
          if (error) debug('Error while creating recurrent job', error);
          else debug('Registered recurrent job', job_type, 'at', job_id);
        });
      } else {
        debug('Ignored pre-existing recurrent job', job_type);
      }
    });
  } else if (conf.get('jobs:' + job_type + ':service')) {
    debug('Starting service', job_type);
    executor.startService(job_type, conf.get('jobs:' + job_type),
      function(svc_err, data) {
        if (svc_err) debug(svc_err);
        else {
          // Store service id for later usage
          svc_mappings[job_type] = data.Id;
        }
    });
  }
});

var serviceBacklogTimeout = setTimeout(checkServiceJobsBacklog, 30000);
var checkServiceJobsBacklog = function () {
  Object.keys(conf.get('jobs')).forEach( function(job_type) {
    if(conf.get('jobs:' + job_type + ':service')) {
      q.inactiveCount(job_type, function(err, total) {
        if (err) {
          debug('Error getting total queued jobs for service',
            job_type, err);
        } else if (total > 1000) { // TODO: Justify number or take from user
          executor.scale(svc_mappings[job_type],
            conf.get('jobs:' + job_type + ':service'), function(error) {
              if (error) {
                debug('Error scaling service',
                  job_type, err);
              } else {
                debug('Successfully scaled', job_type);
              }
            });
        }
      });
    }
  });

  if (serviceBacklogTimeout) { clearTimeout(serviceBacklogTimeout) }
  serviceBacklogTimeout = setTimeout(checkServiceJobsBacklog, 30000);
}



exports.addJob = addJob;
exports.removeJob = removeJob;
exports.jobState = jobState;


// // Test method
// var executor = {
//   execute : function(job, opts, callback) {
//     debug('got data', job.data, opts);
//     callback();
//   },
//   scale : function(job_name, service_opts, callback) {
//     debug('got request to scale', job_name, 'with', service_opts);
//     callback();
//   }
// }

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
//   debug( 'Job %s got queued of type %s', id, type );
// })
