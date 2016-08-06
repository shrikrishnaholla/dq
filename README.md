# dq
Task Scheduler for Docker Functions

DQ is an amalgamation of the best features of a job scheduler like [resque](https://github.com/resque/resque) and a serverless platform like [AWS lambda](https://aws.amazon.com/lambda/details/). It is meant to be self-hosted and called using REST APIs. All tasks run on docker containers defined in a spec similar to compose called `dq.yml`

### Features
- Call a background task with arguments [Ex: sending email]
- Schedule a recurring task [Ex: backing up db]
- Run a background service that handles HTTP requests and auto scales based on load [voting, spam checking]

## Requirements
To use some features like services, you will need Docker 1.12 or above

## Usage
Pull from Docker Hub
  - Create a `dq.yml` configuration (see [sample dq.yml](https://github.com/shrikrishnaholla/dq/blob/master/dq.yml) in this repo)
  - Run the docker container for DQ, mounting the docker socket and `dq.yml` at `/dq/dq.yml` path in the container
  ```docker run -d --name dq -v /path/to/dq.yml:/dq/dq.yml -v /var/run/docker.sock:/var/run/docker.sock shrikrishna/dq```

## Development
Fork/clone this repo and edit `dq.yml`
  - [Fork this repo](https://github.com/shrikrishnaholla/dq/blob/master/dq.yml#fork-destination-box)
  - ```docker-compose up -d```


