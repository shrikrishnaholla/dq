var nconf = require('nconf');
var yaml = require('js-yaml');

var job_config = __dirname + '/../dq.yml';

// load cmd line args and environment vars
nconf.argv().env();

// load a yaml file using a custom formatter
nconf.file({
  file: job_config,
  format: {
    parse: yaml.safeLoad,
    stringify: yaml.safeDump,
  }
});

module.exports = nconf;
