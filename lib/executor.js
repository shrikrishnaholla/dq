var Docker = require('dockerode')
  , docker = new Docker({socketPath: '/var/run/docker.sock'})
  , S = require('string')
  , request = require('request')
  , os = require('os')
  , debug = require('debug')('dq:executor');

var execute = function (job, opts, callback) {

  var command;
  if (job.data.command) {
    command = opts.command ? S(opts.command).template(job.data.command).s
      .split(/(?:\r\n|\r|\n| )/g) : job.data.command;
  }

  var volumeArr;
  if (opts.volumes) {
    volumeArr = opts.volumes.map(function(volumeStr) { return volumeStr.split(':')} );
  }

  var createOpts = {
    Image: opts.image,
    AttachStdin: false,
    AttachStdout: false,
    AttachStderr: false,
    Tty: false,
  };
  if (command) {
    createOpts.Cmd = command;
  }
  if (volumeArr && volumeArr.length > 0) {
    createOpts.Volumes = {};
    createOpts.HostConfig = {};
    volumeArr.forEach(function(volumeDetails, index, arr) {
      if (volumeDetails.length <= 0) {
        return callback(new Error('Invalid volume string: ' + arr[index]));
      }
      else if (volumeDetails.length == 1) {
        createOpts.Volumes[volumeDetails[0]] = {};
      } else {
        createOpts.Volumes[volumeDetails[1]] = {};
        if(!createOpts.HostConfig.Binds) createOpts.HostConfig.Binds = [];
        createOpts.HostConfig.Binds.push(opts.volumes[index]);
      }
    });
  }

  createOpts.Labels = {
    "DQ": opts.job_name
  }

  debug('creating container with opts', createOpts);

  // docker.createContainer({
  //   Image: 'ubuntu',
  //   Cmd: ['/bin/ls', '/stuff'],
  //   'Volumes': {
  //     '/stuff': {}
  //   }
  // }, function(err, container) {
  //   container.attach({
  //     stream: true,
  //     stdout: true,
  //     stderr: true,
  //     tty: true
  //   }, function(err, stream) {
  //     stream.pipe(process.stdout);

  //     container.start({
  //       'Binds': ['/home/vagrant:/stuff']
  //     }, function(err, data) {
  //       console.log(data);
  //     });
  //   });
  // });

  docker.run(opts.image, command, undefined, createOpts, function (err, data, container) {
    debug('run', opts.image, data);
    if (callback) {
      if (err) { return callback(err) }
      callback();
    } else {
      debug(err, data);
    }
  });
}

var scale = function (service_name, service_opts, num_queued, callback) {

  var service = docker.getService(service_name);

  service.inspect(function(insp_err, svc_data) {
    // Don't replicate beyond the limits set by max_replica
    if (num_queued > 0 && svc_data.Spec.Mode.Replicated.Replicas >= service_opts.service.max_replica) {
      return callback(new Error('Service' + service_opts.image +
        'already at max replica capacity'));
    } else if (num_queued == 0 && svc_data.Spec.Mode.Replicated.Replicas == 1) {
      return callback(new Error('Service' + service_opts.image +
        'already at min replica capacity'));
    }

    var updateOpts = {
      Name: service_name, // Need name else will be set to random name
      version: svc_data.Version.Index, // Needed
      TaskTemplate: {
        ContainerSpec: {
          Image: service_opts.image
        }
      },
      Mode: {
        Replicated: { // Scale by one
          Replicas: num_queued == 0 ? svc_data.Spec.Mode.Replicated.Replicas - 1 : // if 0, scale down, else scale up
            svc_data.Spec.Mode.Replicated.Replicas + 1
        }
      },

      // Networks : [svc_data.Endpoint.VirtualIPs.NetworkID],

      EndpointSpec :  {
        Ports: [
          {
            Protocol: "tcp",
            PublishedPort: service_opts.service.port
          }
        ]
      }

    };

    debug('Scaling with updateOpts', updateOpts);
    docker.getService(svc_data.ID).update(updateOpts, function(err, data, service) {
      if (callback) {
        if (err) return callback(err);
        else callback(null, data, num_queued == 0 ? svc_data.Spec.Mode.Replicated.Replicas - 1 :
            svc_data.Spec.Mode.Replicated.Replicas + 1);
      } else {
        debug(err, data);
      }
    });
  });

}

var startService = function(name, opts, callback) {

  var service = docker.getService(name);
  service.inspect(function(insp_err, svc_data) {
    if (insp_err && insp_err.statusCode == 404) {
      // Service doesn't exist. Create.
      var volumeArr;
      if (opts.volumes) {
        volumeArr = opts.volumes.map(function(volumeStr) { return volumeStr.split(':')} );
      }

      var createOpts = {
        Name: name,
        TaskTemplate: {
          ContainerSpec: {
            Image: opts.image
          }
        },
        Mode: {
          Replicated: {
            Replicas: 1
          }
        },
      }

      if (opts.command) {
        createOpts.TaskTemplate.ContainerSpec.Command = opts.command;
      }
      if (volumeArr && volumeArr.length > 0) {
        createOpts.TaskTemplate.ContainerSpec.Mounts = [];

        volumeArr.forEach(function(volumeDetails, index, arr) {
          var next_volume = {};
          if (volumeDetails.length <= 0) {
            return callback(new Error('Invalid volume string: ' + arr[index]));
          }
          else if (volumeDetails.length == 1) {
            next_volume.Target = volumeDetails[0];
            next_volume.Type = 'volume';
          } else {
            next_volume.Source = volumeDetails[0];
            next_volume.Target = volumeDetails[1];
            if (volumeDetails.length == 3) {
              if (volumeDetails[2] == 'ro') next_volume.ReadOnly = true;
              else if (volumeDetails[2] == 'rw') next_volume.ReadOnly = false;
            } else {
              next_volume.ReadOnly = false;
            }
          }

          createOpts.TaskTemplate.ContainerSpec.Mounts.push(next_volume);
        });
      }
      createOpts.Labels = {
        "DQ": opts.job_name,
        "DQ:Service": "true"
      }

      createOpts.EndpointSpec =  {
        Ports: [
          {
            Protocol: "tcp",
            PublishedPort: opts.service.port
          }
        ]
      }


      createService(createOpts, callback);

    } else {
      // Service already exists. Return
      callback(null, svc_data);
    }
  });

}


var createService = function(createOpts, callback, previouslyAttempted) {
  docker.createService(createOpts, function(err, data) {
    if (callback) {
      if (err) {
        if (previouslyAttempted) { return callback(err); } // Prevent stack overflow
        if (err.statusCode == 406) {
          // Init Swarm and try again
          initSwarm(function(swarm_err) {
            if (swarm_err) {
              if (callback) return callback(swarm_err);
            } else {
              if (!previouslyAttempted) { previouslyAttempted = true }
              createService(createOpts, callback, previouslyAttempted);
            }
          });
        }
        return callback(err);
      }
      else {
        // Successful creation of service
        var service = docker.getService(createOpts.Name);
        service.inspect(function(insp_err, svc_data) {
          if (insp_err) debug(insp_err);
          // Connect DQ container to service container's Network
          debug('svc data before connecting networks', svc_data);
          connectNetwork(svc_data.Endpoint.VirtualIPs[0].NetworkID, function(conn_err) {
            debug('Connected to service\'s network', conn_err);
            callback(null, data);
          });
        });
      }
    } else {
      debug(err, data);
    }
  });
}

var initSwarm = function(callback) {
  debug('Initializing swarm');
  docker.swarmInit({
    "ListenAddr": "0.0.0.0:4500",
    "AdvertiseAddr": "192.168.1.1:4500",
    "ForceNewCluster": false,
    "Spec": {
      "Orchestration": {},
      "Raft": {},
      "Dispatcher": {},
      "CAConfig": {}
    }
  }, callback);
}


// Executor method that makes request to the service backends
var mkRequest = function(service_name, opts, callback) {
  var service = docker.getService(service_name);

  service.inspect(function(insp_err, svc_data) {
    if (insp_err) debug(insp_err);
    var container_ip = svc_data.Endpoint.VirtualIPs[0].Addr.split('/')[0];
    var base = 'http://' + container_ip + ':' + svc_data.Endpoint.Ports[0].PublishedPort; // base url
    debug('Making', opts.method, 'request to', base, 'at', opts.uri, 'with qs', opts.qs, 'and body', opts.body);

    request({
      method: opts.method,
      uri: opts.uri,
      baseUrl: base,
      qs: opts.qs,
      body: opts.body
      // json: opts.json || false TODO
    }, function(error, response, body) {
      if (error) return callback(error);
      callback(null, response);
    });

  });
}

var connectNetwork = function(network_id, callback) {
  var network = docker.getNetwork(network_id);
  network.connect({
    Container: os.hostname()
  }, callback)
}

exports.execute = execute;
exports.startService = startService;
exports.scale = scale;
exports.mkRequest = mkRequest;
