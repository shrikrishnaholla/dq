# dq
Task Scheduler for Docker Functions

DQ is an amalgamation of the best features of a job scheduler like [resque](https://github.com/resque/resque) and a serverless platform like [AWS lambda](https://aws.amazon.com/lambda/details/). It is meant to be self-hosted and called using REST APIs. All tasks run on docker containers defined in a spec similar to compose called `dq.yml`

[![DQ](http://img.youtube.com/vi/XT2CeC6oMBU/0.jpg)](http://www.youtube.com/watch?v=XT2CeC6oMBU "DQ: Task Scheduler for Docker Functions")
> DQ won [4th place](https://blog.docker.com/2016/08/announcing-docker-1-12-hackathon-winners/) in the Docker 1.12 Hackathon

### Features
- Call a background task with arguments [Ex: sending email]
- Schedule a recurring task [Ex: backing up db]
- Run a background service that handles HTTP requests and auto scales based on load [voting, spam checking]

## Requirements
To use some features like services, you will need Docker 1.12 or above

## Usage
- Create a `dq.yml` based on the [sample](https://github.com/shrikrishnaholla/dq/blob/master/dq.yml) in this repo
- Create a network  
  ```docker network create dq_net```
- Start redis  
  ```docker run -d --name redis --net dq_net redis```
- Start DQ  
  ```docker run -it --net dq_net --name dq -p "5972:3000" -p "5973:3001" \
  -v $(pwd)/dq.yml:/dq/dq.yml -v /var/run/docker.sock:/var/run/docker.sock \
  shrikrishna/dq```

## Development
Fork/clone this repo and edit `dq.yml`
- [Fork this repo](https://github.com/shrikrishnaholla/dq/#fork-destination-box)
- ```docker-compose up -d```


