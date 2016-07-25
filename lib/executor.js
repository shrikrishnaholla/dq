var Docker = require('dockerode')
  , docker = new Docker({socketPath: '/var/run/docker.sock'})
  , S = require('string')
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
        createOpts.HostConfig.Binds.append(opts.volumes[index]);
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

var scale = function (service_id, service_opts, callback) {

  var service = docker.getService(service_id);

  service.inspect(function(insp_err, svc_data) {
    // Don't replicate beyond the limits set by max_replica
    if (svc_data.Spec.Mode.Replicated.Replicas >= service_opts.service.max_replica) {
      return callback(new Error('Service' + service_opts.image +
        'already at max replica capacity'));
    }

    var updateOpts = {
      Mode: {
        Replicated: { // Scale by one
          Replicas: svc_data.Spec.Mode.Replicated.Replicas + 1
        }
      }
    };
    service.update(updateOpts, function(err, data, service) {
    if (callback) {
      if (err) return callback(err);
      else callback(null, data);
    } else {
      debug(err, data);
    }
  });

}

var startService = function(name, opts, callback) {

  var command;
  if (job.data.command) {
    command = opts.command ? S(opts.command).template(job.data.command || {}).s
      .split(/(?:\r\n|\r|\n| )/g) : job.data.command;
  }


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

  if (command) {
    createOpts.TaskTemplate.ContainerSpec.Command = command;
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

      createOpts.TaskTemplate.ContainerSpec.Mounts.append(next_volume);
    });
  }
  createOpts.Labels = {
    "DQ": opts.job_name,
    "DQ:Service": "true"
  }

  createOpts.EndpointSpec =  {
    ExposedPorts: [
      {
        Protocol: "tcp",
        Port: opts.service.port
      }
    ]
  }

  docker.createService(createOpts, function(err, data, service) {
    if (callback) {
      if (err) return callback(err);
      else callback(null, data);
    } else {
      debug(err, data);
    }
  });


}

//TODO: Executor method that makes request to the service backends
var mkRequest = function(id, opts, callback) {

}

exports.execute = execute;
exports.startService = startService;
exports.scale = scale;
exports.mkRequest = mkRequest;
