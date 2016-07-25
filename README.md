# dq
Task Scheduler for Docker Functions

DQ is an amalgamation of the best features of a job scheduler like [resque](https://github.com/resque/resque) and a serverless platform like [AWS lambda](https://aws.amazon.com/lambda/details/). It is meant to be self-hosted and called using REST APIs. All tasks run on docker containers defined in a spec similar to compose called `dq.yml`

### Features
- Call a background task with arguments [Ex: sending email]
- Schedule a recurring task [Ex: backing up db]
- Run a background service that handles HTTP requests and auto scales based on load [voting, spam checking]
