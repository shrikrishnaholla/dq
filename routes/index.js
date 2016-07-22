var express = require('express');
var router = express.Router();
var Docker = require('dockerode');

/* GET home page. */
router.get('/run_image', function(req, res, next) {

    console.log(req.query.image_name);
    // console.log(req.query.command.split(' '));

	var docker = new Docker({socketPath: '/var/run/docker.sock'});
    docker.pull(req.query.image_name, function(err, stream) {
        // streaming output from pull...
        console.log('pulling ' + req.query.image_name);
        docker.modem.followProgress(stream, onFinished, onProgress);
        function onFinished(err, output) {
            // function run_task(image, command) {
    //             docker.run(image, command, [process.stdout, process.stderr], { Tty: false }, function(err, data, container) {
    //                 //...
    //             }).on('container', function(container) {
    //                 container.defaultOptions.start.Binds = ["/tmp:/tmp:rw"];
    //             });
    //         }
            console.log('Finished Pulling');
            console.log(output);
            docker.run(req.query.image_name, req.query.command?req.query.command.split(' '):'', process.stdout, function (err, data, container) {
				console.log(data);
			});
        }
        function onProgress(event) {
			console.log(event);
		}
    });
    res.json({ success: true });
});

module.exports = router;
